{
  description = "Magic Context: cross-session memory and context management for coding agents";

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

      checks = eachSystem (
        pkgs:
        let
          inherit (bun2nixFor pkgs) version;
          updateScript = (lib.importJSON ./package.json).scripts."update:nix";
        in
        {
          inherit (self.packages.${pkgs.stdenv.hostPlatform.system}) pi-magic-context;

          # `bun run update:nix` generates nix/bun.nix with bun2nix from npm;
          # it must match the bun2nix that consumes the file here.
          bun2nix-version-pin =
            assert lib.assertMsg (lib.hasInfix "bun2nix@${version} " updateScript) ''
              The update:nix script in package.json must pin bun2nix@${version}, the
              version in flake.lock. Update the pin, then run `bun run update:nix`.
            '';
            pkgs.emptyFile;
        }
      );

      devShells = eachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.nodejs_24
            pkgs.cargo
            pkgs.rustc
            pkgs.clippy
            pkgs.rustfmt
          ];
        };
      });

      formatter = eachSystem (pkgs: pkgs.nixfmt-tree);
    };
}
