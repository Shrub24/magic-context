{
  description = "Magic Context (Shrub24 fork): Nix packaging for the Pi/OMP extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    bun2nix = {
      url = "github:nix-community/bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      bun2nix,
    }:
    let
      inherit (nixpkgs) lib;

      # The systems bun2nix supports.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      eachSystem = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      bun2nixFor = pkgs: bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
    in
    {
      overlays.default = final: _prev: {
        pi-magic-context = final.callPackage ./nix/package.nix { bun2nix = bun2nixFor final; };
      };

      packages = eachSystem (pkgs: {
        pi-magic-context = pkgs.callPackage ./nix/package.nix { bun2nix = bun2nixFor pkgs; };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.pi-magic-context;
      });

      checks = eachSystem (pkgs: {
        inherit (self.packages.${pkgs.stdenv.hostPlatform.system}) pi-magic-context;

        # nix/bun.nix is generated from bun.lock; fail when an upstream sync
        # moves the lockfile without regenerating it.
        bun-nix-up-to-date =
          pkgs.runCommand "bun-nix-up-to-date"
            {
              nativeBuildInputs = [
                (bun2nixFor pkgs)
                pkgs.nixfmt
              ];
            }
            ''
              bun2nix --lock-file ${./bun.lock} --copy-prefix ../ | nixfmt | diff -u ${./nix/bun.nix} - \
                || { echo "nix/bun.nix is stale; run: nix run .#update-bun-nix" >&2; exit 1; }
              touch $out
            '';
      });

      apps = eachSystem (pkgs: {
        update-bun-nix = {
          type = "app";
          program = lib.getExe (
            pkgs.writeShellApplication {
              name = "update-bun-nix";
              runtimeInputs = [
                (bun2nixFor pkgs)
                pkgs.git
                pkgs.nixfmt
              ];
              text = ''
                root=$(git rev-parse --show-toplevel)
                bun2nix --lock-file "$root/bun.lock" --copy-prefix ../ | nixfmt > "$root/nix/bun.nix"
              '';
            }
          );
          meta.description = "Regenerate nix/bun.nix from bun.lock";
        };
      });

      devShells = eachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.nodejs_22
            pkgs.cargo
            pkgs.rustc
            (bun2nixFor pkgs)
          ];
        };
      });

      formatter = eachSystem (pkgs: pkgs.nixfmt-tree);
    };
}
