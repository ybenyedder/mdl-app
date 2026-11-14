#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="$HOME/.cargo/bin:$PATH"

MANIFEST_PATH="crates/mdl-wasm/Cargo.toml"
WASM_TARGET_PATH="crates/mdl-wasm/target/wasm32-unknown-unknown/release/mdl_wasm.wasm"
OUT_DIR="apps/web/src/lib/wasm-pkg"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Erreur : cargo introuvable dans le PATH." >&2
  exit 1
fi

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "Erreur : wasm-bindgen introuvable dans le PATH (attendu dans ~/.cargo/bin)." >&2
  exit 1
fi

echo "[1/3] Compilation Rust -> wasm32-unknown-unknown (release)..."
cargo build --manifest-path "$MANIFEST_PATH" --target wasm32-unknown-unknown --release

if [[ ! -s "$WASM_TARGET_PATH" ]]; then
  echo "Erreur : artefact WASM introuvable ou vide : $WASM_TARGET_PATH" >&2
  exit 1
fi

echo "[2/3] Génération des bindings JS/TS avec wasm-bindgen..."
mkdir -p "$OUT_DIR"
wasm-bindgen --target web --out-dir "$OUT_DIR" "$WASM_TARGET_PATH"

echo "[3/3] Vérification des fichiers générés..."
WASM_OUT="$OUT_DIR/mdl_wasm_bg.wasm"
JS_OUT="$OUT_DIR/mdl_wasm.js"

if [[ ! -s "$WASM_OUT" ]]; then
  echo "Erreur : fichier .wasm généré manquant ou vide : $WASM_OUT" >&2
  exit 1
fi

if [[ ! -s "$JS_OUT" ]]; then
  echo "Erreur : fichier .js généré manquant ou vide : $JS_OUT" >&2
  exit 1
fi

ls -lh "$WASM_OUT" "$JS_OUT"
echo "Build WASM terminé avec succès."
