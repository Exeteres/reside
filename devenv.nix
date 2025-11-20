{
  pkgs,
  inputs,
  ...
}: let
  pkgs-unstable = import inputs.nixpkgs-unstable {system = pkgs.stdenv.system;};
in {
  languages.javascript.enable = true;
  languages.javascript.bun.enable = true;
  languages.javascript.bun.package = pkgs-unstable.bun;

  scripts.reside.exec = "$DEVENV_ROOT/apps/cli/src/main.ts $@";

  packages = with pkgs; [
    biome
    kind
    kubernetes-helm
    kubectl
    cloud-provider-kind
    regctl
    libsecret
  ];
}
