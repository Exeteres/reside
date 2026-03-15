package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/lestrrat-go/jwx/v2/jwk"
	jwxjwt "github.com/lestrrat-go/jwx/v2/jwt"
	"github.com/urfave/cli/v2"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/server/common/authorization"
	"go.temporal.io/server/common/config"
	"go.temporal.io/server/common/dynamicconfig"
	serverlog "go.temporal.io/server/common/log"
	"go.temporal.io/server/common/primitives"
	"go.temporal.io/server/temporal"
	"k8s.io/client-go/rest"
)

type openIDConfiguration struct {
	Issuer  string `json:"issuer"`
	JwksURI string `json:"jwks_uri"`
}

type replicaIdentity struct {
	Subject            string
	Namespace          string
	ServiceAccountName string
}

type tokenVerifier struct {
	issuer   string
	keySet   jwk.Set
	audience string
}

type replicaClaimMapper struct {
	verifier             *tokenVerifier
	systemAdminNamespace string
}

func (*replicaClaimMapper) AuthInfoRequired() bool {
	return false
}

func main() {
	app := buildCLI()
	_ = app.Run(os.Args)
}

func buildCLI() *cli.App {
	app := cli.NewApp()
	app.Name = "temporal-server"
	app.Usage = "Temporal server with Kubernetes service-account authentication"
	app.Flags = []cli.Flag{
		&cli.StringFlag{
			Name:    "root",
			Aliases: []string{"r"},
			Value:   ".",
			EnvVars: []string{config.EnvKeyRoot},
		},
		&cli.StringFlag{
			Name:    "config",
			Aliases: []string{"c"},
			Value:   "config",
			EnvVars: []string{config.EnvKeyConfigDir},
		},
		&cli.StringFlag{
			Name:    "env",
			Aliases: []string{"e"},
			Value:   "development",
			EnvVars: []string{config.EnvKeyEnvironment},
		},
		&cli.StringFlag{
			Name:    "zone",
			Aliases: []string{"az"},
			EnvVars: []string{config.EnvKeyAvailabilityZone, config.EnvKeyAvailabilityZoneTypo},
		},
		&cli.BoolFlag{
			Name:    "allow-no-auth",
			EnvVars: []string{config.EnvKeyAllowNoAuth},
		},
	}
	app.Commands = []*cli.Command{
		{
			Name:  "start",
			Usage: "Start Temporal server",
			Flags: []cli.Flag{
				&cli.StringFlag{
					Name:   "services",
					Hidden: true,
				},
				&cli.StringSliceFlag{
					Name:    "service",
					Aliases: []string{"svc"},
					Value:   cli.NewStringSlice(temporal.DefaultServices...),
					EnvVars: []string{"TEMPORAL_SERVICES"},
				},
			},
			Action: startServer,
		},
	}

	return app
}

func startServer(c *cli.Context) error {
	services := c.StringSlice("service")
	if c.IsSet("services") {
		services = strings.Split(c.String("services"), ",")
	}

	cfg, err := loadTemporalConfig(c)
	if err != nil {
		return cli.Exit(fmt.Sprintf("Unable to load configuration: %v.", err), 1)
	}

	logger := serverlog.NewZapLogger(serverlog.BuildZapLogger(cfg.Log))
	dynamicConfigClient, err := loadDynamicConfigClient(cfg, logger)
	if err != nil {
		return cli.Exit(fmt.Sprintf("Unable to create dynamic config client. Error: %v", err), 1)
	}

	claimMapper, err := newReplicaClaimMapper(context.Background())
	if err != nil {
		return cli.Exit(fmt.Sprintf("Unable to initialize Kubernetes claim mapper. Error: %v", err), 1)
	}

	server, err := temporal.NewServer(
		temporal.ForServices(services),
		temporal.WithConfig(cfg),
		temporal.WithDynamicConfigClient(dynamicConfigClient),
		temporal.WithLogger(logger),
		temporal.InterruptOn(temporal.InterruptCh()),
		temporal.WithAuthorizer(authorization.NewDefaultAuthorizer()),
		temporal.WithClaimMapper(func(*config.Config) authorization.ClaimMapper {
			return claimMapper
		}),
	)
	if err != nil {
		return cli.Exit(fmt.Sprintf("Unable to create server. Error: %v.", err), 1)
	}

	err = server.Start()
	if err != nil {
		return cli.Exit(fmt.Sprintf("Unable to start server. Error: %v", err), 1)
	}

	return cli.Exit("All services are stopped.", 0)
}

func loadTemporalConfig(c *cli.Context) (*config.Config, error) {
	return config.LoadConfig(
		c.String("env"),
		path.Join(c.String("root"), c.String("config")),
		c.String("zone"),
	)
}

func loadDynamicConfigClient(
	cfg *config.Config,
	logger serverlog.Logger,
) (dynamicconfig.Client, error) {
	if cfg.DynamicConfigClient == nil {
		logger.Info("Dynamic config client is not configured. Using noop client.")
		return dynamicconfig.NewNoopClient(), nil
	}

	return dynamicconfig.NewFileBasedClient(
		cfg.DynamicConfigClient,
		logger,
		temporal.InterruptCh(),
	)
}

func newReplicaClaimMapper(ctx context.Context) (*replicaClaimMapper, error) {
	verifier, err := newTokenVerifier(ctx)
	if err != nil {
		return nil, err
	}

	systemAdminNamespace, err := getCurrentNamespace()
	if err != nil {
		return nil, err
	}

	return &replicaClaimMapper{
		verifier:             verifier,
		systemAdminNamespace: systemAdminNamespace,
	}, nil
}

func (m *replicaClaimMapper) GetClaims(
	authInfo *authorization.AuthInfo,
) (*authorization.Claims, error) {
	if authInfo == nil || strings.TrimSpace(authInfo.AuthToken) == "" {
		return &authorization.Claims{
			System: authorization.RoleAdmin,
			Namespaces: map[string]authorization.Role{
				primitives.SystemLocalNamespace: authorization.RoleAdmin,
			},
		}, nil
	}

	identity, err := m.verifier.verify(authInfo.AuthToken)
	if err != nil {
		return nil, serviceerror.NewPermissionDenied(
			fmt.Sprintf("invalid Kubernetes service-account token: %v", err),
			"",
		)
	}

	claims := &authorization.Claims{
		Subject: identity.Subject,
		Namespaces: map[string]authorization.Role{
			identity.Namespace: authorization.RoleAdmin,
		},
	}

	if identity.Namespace == m.systemAdminNamespace {
		claims.System = authorization.RoleAdmin
		claims.Namespaces[primitives.SystemLocalNamespace] = authorization.RoleAdmin
	}

	return claims, nil
}

func newTokenVerifier(ctx context.Context) (*tokenVerifier, error) {
	audience, err := getRequiredAudience()
	if err != nil {
		return nil, err
	}

	clusterConfig, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("create in-cluster config: %w", err)
	}

	transport, err := rest.TransportFor(clusterConfig)
	if err != nil {
		return nil, fmt.Errorf("create Kubernetes transport: %w", err)
	}

	httpClient := &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
	}

	discoveryDocument, err := fetchOpenIDConfiguration(
		ctx,
		httpClient,
		strings.TrimRight(clusterConfig.Host, "/"),
	)
	if err != nil {
		return nil, err
	}

	keySet, err := fetchJWKSet(ctx, httpClient, discoveryDocument.JwksURI)
	if err != nil {
		return nil, err
	}

	return &tokenVerifier{
		issuer:   discoveryDocument.Issuer,
		keySet:   keySet,
		audience: audience,
	}, nil
}

func fetchOpenIDConfiguration(
	ctx context.Context,
	httpClient *http.Client,
	clusterHost string,
) (*openIDConfiguration, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		clusterHost+"/.well-known/openid-configuration",
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create OIDC discovery request: %w", err)
	}

	response, err := httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetch OIDC discovery document: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected OIDC discovery status: %s", response.Status)
	}

	var document openIDConfiguration
	if err := json.NewDecoder(response.Body).Decode(&document); err != nil {
		return nil, fmt.Errorf("decode OIDC discovery document: %w", err)
	}

	if document.Issuer == "" || document.JwksURI == "" {
		return nil, errors.New("OIDC discovery document is missing issuer or jwks_uri")
	}

	return &document, nil
}

func fetchJWKSet(ctx context.Context, httpClient *http.Client, jwksURI string) (jwk.Set, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURI, nil)
	if err != nil {
		return nil, fmt.Errorf("create JWKS request: %w", err)
	}

	response, err := httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetch JWKS: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected JWKS status: %s", response.Status)
	}

	keySet, err := jwk.ParseReader(response.Body)
	if err != nil {
		return nil, fmt.Errorf("parse JWKS: %w", err)
	}

	return keySet, nil
}

func (v *tokenVerifier) verify(rawAuthorization string) (*replicaIdentity, error) {
	tokenString, err := parseBearerToken(rawAuthorization)
	if err != nil {
		return nil, err
	}

	token, err := jwxjwt.ParseString(
		tokenString,
		jwxjwt.WithKeySet(v.keySet),
		jwxjwt.WithValidate(true),
		jwxjwt.WithIssuer(v.issuer),
		jwxjwt.WithAudience(v.audience),
		jwxjwt.WithAcceptableSkew(time.Minute),
	)
	if err != nil {
		return nil, fmt.Errorf("verify JWT: %w", err)
	}

	audienceClaim, ok := token.Get("aud")
	if !ok {
		return nil, errors.New(`JWT is missing the "aud" claim`)
	}

	if err := ensureExactAudience(audienceClaim, v.audience); err != nil {
		return nil, err
	}

	subject := token.Subject()
	if subject == "" {
		return nil, errors.New(`JWT is missing the "sub" claim`)
	}

	namespace, serviceAccountName, err := parseReplicaSubject(subject)
	if err != nil {
		return nil, err
	}

	return &replicaIdentity{
		Subject:            subject,
		Namespace:          namespace,
		ServiceAccountName: serviceAccountName,
	}, nil
}

func parseBearerToken(rawAuthorization string) (string, error) {
	parts := strings.SplitN(strings.TrimSpace(rawAuthorization), " ", 2)
	if len(parts) != 2 {
		return "", errors.New("authorization header must use Bearer token format")
	}

	if !strings.EqualFold(parts[0], "Bearer") {
		return "", errors.New("authorization header must use Bearer scheme")
	}

	if strings.TrimSpace(parts[1]) == "" {
		return "", errors.New("authorization header is missing token value")
	}

	return parts[1], nil
}

func parseReplicaSubject(subject string) (string, string, error) {
	parts := strings.Split(subject, ":")
	if len(parts) != 4 {
		return "", "", fmt.Errorf("invalid replica subject: %q", subject)
	}

	if parts[0] != "system" || parts[1] != "serviceaccount" {
		return "", "", fmt.Errorf("invalid replica subject: %q", subject)
	}

	if parts[2] == "" || parts[3] == "" {
		return "", "", fmt.Errorf("invalid replica subject: %q", subject)
	}

	return parts[2], parts[3], nil
}

func getCurrentNamespace() (string, error) {
	if value := strings.TrimSpace(os.Getenv("POD_NAMESPACE")); value != "" {
		return value, nil
	}

	if value := strings.TrimSpace(os.Getenv("NAMESPACE")); value != "" {
		return value, nil
	}

	data, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace")
	if err != nil {
		return "", fmt.Errorf("read current namespace: %w", err)
	}

	namespace := strings.TrimSpace(string(data))
	if namespace == "" {
		return "", errors.New("current namespace is empty")
	}

	return namespace, nil
}

func getRequiredAudience() (string, error) {
	audience := strings.TrimSpace(os.Getenv("AUDIENCE"))
	if audience == "" {
		return "", errors.New(`"AUDIENCE" environment variable is required`)
	}

	if strings.Contains(audience, " ") {
		return "", errors.New(`"AUDIENCE" environment variable must not contain spaces`)
	}

	return audience, nil
}

func ensureExactAudience(audienceClaim any, expectedAudience string) error {
	switch value := audienceClaim.(type) {
	case string:
		if value == expectedAudience {
			return nil
		}

		return fmt.Errorf(
			"JWT audience mismatch: expected exactly %q, got %q",
			expectedAudience,
			value,
		)
	case []string:
		if len(value) == 1 && value[0] == expectedAudience {
			return nil
		}

		return fmt.Errorf(
			"JWT audience mismatch: expected exactly [%q], got %v",
			expectedAudience,
			value,
		)
	case []any:
		if len(value) == 1 {
			audienceValue, ok := value[0].(string)
			if ok && audienceValue == expectedAudience {
				return nil
			}
		}

		return fmt.Errorf(
			"JWT audience mismatch: expected exactly [%q], got %v",
			expectedAudience,
			value,
		)
	default:
		return fmt.Errorf("JWT audience claim has unsupported type %T", audienceClaim)
	}
}
