{
  pkgs,
  inputs,
  ...
}: let
  pkgs-unstable = import inputs.nixpkgs-unstable {system = pkgs.stdenv.system;};

  prisma = inputs.prisma-utils.lib.prisma-factory {
    inherit pkgs;
    hash = "sha256-HIIU9yVwgbprjYhBL+Pwfu6gYeKDpXAoQGsXFwTOZ0Y=";
    versionString = "7.5.0-10.94a226be1cf2967af2541cca5529f0f7ba866919";
  };
in {
  languages.javascript.enable = true;
  languages.javascript.bun.enable = true;
  languages.javascript.bun.package = pkgs-unstable.bun;

  languages.go.enable = true;

  # for prisma migrations only
  services.postgres.enable = true;

  scripts.reside.exec = "NODE_TLS_REJECT_UNAUTHORIZED=0 $DEVENV_ROOT/apps/cli/src/main.ts $@";

  enterShell = ''
    export KUBECONFIG="$HOME/.kube/reside.yaml"
  '';

  env = prisma.env;

  packages = with pkgs; [
    biome
    kind
    kubernetes-helm
    kubectl
    cloud-provider-kind
    regctl
    libsecret
    ffmpeg
    chromium
  ];
}
