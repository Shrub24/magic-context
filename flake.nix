{
  description = "Magic Context Pi/OMP extension package";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    bun2nix.url = "github:nix-community/bun2nix/0f2a1f0b6f42cebe3b149bf62d38754c5e0e9729";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, bun2nix }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          bunNix = import ./nix/bun.nix;
          source = self;
        in {
          pi-magic-context = pkgs.stdenvNoCC.mkDerivation {
            pname = "pi-magic-context";
            version = (builtins.fromJSON (builtins.readFile ./packages/pi-plugin/package.json)).version;
            src = source;
            nativeBuildInputs = [ bun2nix.packages.${system}.default pkgs.bun ];
            bunRoot = "nix";
            bunDeps = bun2nix.packages.${system}.default.passthru.fetchBunDeps { inherit bunNix; };
            dontUseBunBuild = true;
            dontUseBunCheck = true;
            dontFixup = true;
            buildPhase = ''
              runHook preBuild
              cd ..
              bun run build
              cd packages/pi-plugin
              bun run build
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -R dist "$out/dist"
              cp package.json "$out/package.json"
              cp README.md "$out/README.md"
              runHook postInstall
            '';
            meta = {
              description = "Magic Context context management extension for Pi and OMP";
              platforms = systems;
            };
          };
          default = self.packages.${system}.pi-magic-context;
        });
    };
}
