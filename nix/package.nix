{
  lib,
  stdenvNoCC,
  bun2nix,
}:

let
  packageJson = lib.importJSON ../packages/pi-plugin/package.json;

  # The Bun workspaces the Pi extension build reads from: pi-plugin bundles
  # sources out of plugin, and its build emits retina-local-fs declarations.
  buildWorkspaces = [
    "@cortexkit/pi-magic-context"
    "@cortexkit/opencode-magic-context"
    "@cortexkit/retina-local-fs"
  ];
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "pi-magic-context";
  inherit (packageJson) version;

  # Leave out what the build never reads, so edits there do not rebuild the
  # package. This lists exclusions rather than inputs: a new build input
  # upstream is picked up, and a stale entry only costs a rebuild. Workspace
  # manifests stay in: a frozen install checks the whole bun.lock graph.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      (lib.fileset.difference ../. (
        lib.fileset.unions (
          map lib.fileset.maybeMissing [
            ../.github
            ../assets
            ../context
            ../crates
            ../docs
            ../gate-evidence
            ../packages/cli
            ../packages/dashboard
            ../packages/docs
            ../packages/e2e-tests
            ../testdata
            ../tests
            ../watermark
            ../flake.nix
            ../flake.lock
            ./.
          ]
        )
      ))
      (lib.fileset.fileFilter (file: file.name == "package.json") ../packages)
    ];
  };

  nativeBuildInputs = [ bun2nix.hook ];

  bunDeps = bun2nix.fetchBunDeps {
    # Bun links workspaces from src, so keep them out of the dependency
    # cache; otherwise any edit under packages/ would rebuild it.
    bunNix =
      {
        fetchurl,
        fetchgit,
        fetchFromGitHub,
        ...
      }:
      import ./bun.nix {
        inherit fetchurl fetchgit fetchFromGitHub;
        copyPathToStore = _: null;
      };
  };

  # Install only the build's workspaces, and skip optional native addons
  # (onnxruntime-node, sharp): the bundle keeps them external and their
  # install scripts download binaries, which the sandbox forbids.
  bunInstallFlags = [
    "--frozen-lockfile"
    "--linker=hoisted"
    "--omit=optional"
  ]
  ++ lib.optional stdenvNoCC.hostPlatform.isDarwin "--backend=copyfile"
  ++ map (workspace: "--filter=${workspace}") buildWorkspaces;
  dontRunLifecycleScripts = true;

  buildPhase = ''
    runHook preBuild
    bun run --cwd packages/pi-plugin build
    runHook postBuild
  '';

  # Lay the package out as `npm install` would: the published files plus its
  # production dependencies. The bundle inlines most of them, but resolves
  # onnxruntime-web next to dist/ for local embeddings. Optional peers (the
  # Pi/OMP host packages) come from the host and stay out.
  installPhase = ''
    runHook preInstall

    rm -rf node_modules packages/*/node_modules
    bun install --frozen-lockfile --production --linker=hoisted \
      --omit=optional --omit=peer --ignore-scripts \
      --filter=${lib.escapeShellArg packageJson.name}
    rm -rf node_modules/.bin node_modules/${packageJson.name}
    # fetchBunDeps points dependency shebangs at its build-time fake node;
    # restore the portable form so the output does not keep it alive.
    grep -rlZ '^#!/nix/store/' node_modules \
      | xargs -0 --no-run-if-empty sed -i '1s|^#!/nix/store/[^ ]*/bin/|#!/usr/bin/env |'

    pkgDir=$out/lib/node_modules/${packageJson.name}
    mkdir -p "$pkgDir"
    cp -r packages/pi-plugin/{dist,package.json,README.md} "$pkgDir"/
    cp -r node_modules "$pkgDir"/

    runHook postInstall
  '';

  # The extension is plain JavaScript run by the host's runtime: nothing in
  # it should reference the store, and patching shebangs would add Bun.
  dontPatchShebangs = true;
  allowedReferences = [ ];

  strictDeps = true;
  __structuredAttrs = true;

  passthru = {
    # Path to hand Pi or OMP as a local extension package.
    extensionPath = "${finalAttrs.finalPackage}/lib/node_modules/${packageJson.name}";
  };

  meta = {
    description = "Magic Context extension for the Pi and OMP coding agents: cross-session memory and context management";
    homepage = "https://github.com/Shrub24/magic-context";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];
  };
})
