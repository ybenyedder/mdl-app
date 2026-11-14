use std::collections::BTreeMap;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use wasm_bindgen::prelude::*;

const UTF8_BOM: &str = "\u{FEFF}";
const CSV_DELIMITER: char = ';';
const DEFAULT_CATEGORY: &str = "Sans catégorie";
const DEFAULT_PROJECT: &str = "Hors projet";

/// Compress a PNG, JPEG, or WebP receipt image into a JPEG byte buffer.
///
/// Resizes preserving aspect ratio when width > `max_width`, composites any
/// alpha channel over white, and encodes as JPEG with `quality` clamped to `30..=95`.
#[wasm_bindgen]
pub fn compress_receipt_image(
    bytes: &[u8],
    max_width: u32,
    quality: u8,
) -> Result<Vec<u8>, JsValue> {
    compress_receipt_image_impl(bytes, max_width, quality).map_err(|e| JsValue::from_str(&e))
}

/// Compute budget totals, balance, and breakdowns by category and project from a JSON array.
#[wasm_bindgen]
pub fn compute_budget_summary(entries_json: &str) -> Result<String, JsValue> {
    compute_budget_summary_impl(entries_json).map_err(|e| JsValue::from_str(&e))
}

/// Compute budget summary directly from a JS value using `serde-wasm-bindgen`.
#[wasm_bindgen]
pub fn compute_budget_summary_js(entries: JsValue) -> Result<JsValue, JsValue> {
    let parsed: Vec<BudgetEntryInput> = serde_wasm_bindgen::from_value(entries)
        .map_err(|e| JsValue::from_str(&format!("Entrées budget invalides: {e}")))?;
    let summary = compute_budget_summary_from_entries(&parsed)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&summary)
        .map_err(|e| JsValue::from_str(&format!("Erreur sérialisation résultat: {e}")))
}

/// Export tabular data to an RFC 4180 CSV string with UTF-8 BOM and `;` separator for French Excel.
#[wasm_bindgen]
pub fn export_rows_to_csv(headers_json: &str, rows_json: &str) -> Result<String, JsValue> {
    export_rows_to_csv_impl(headers_json, rows_json).map_err(|e| JsValue::from_str(&e))
}

/// Verify an Ed25519 signature over the ASCII bytes of `payload_b64url`.
///
/// `public_key_hex` must encode 32 bytes in hexadecimal, and `signature_b64url`
/// must encode 64 bytes in unpadded base64url.
#[wasm_bindgen]
pub fn verify_ticket_ed25519(
    payload_b64url: &str,
    signature_b64url: &str,
    public_key_hex: &str,
) -> bool {
    if !payload_b64url.is_ascii() {
        return false;
    }

    let Ok(verifying_key) = decode_ed25519_public_key(public_key_hex) else {
        return false;
    };

    let Ok(sig_bytes) = URL_SAFE_NO_PAD.decode(signature_b64url.trim()) else {
        return false;
    };
    let Ok(sig_array): Result<[u8; 64], _> = sig_bytes.try_into() else {
        return false;
    };
    let signature = Signature::from_bytes(&sig_array);

    verifying_key
        .verify_strict(payload_b64url.as_bytes(), &signature)
        .is_ok()
}

/// Parse and verify an offline QR ticket (`MDL1.<payload_b64url>.<sig_b64url>`).
///
/// Returns the decoded UTF-8 JSON payload on success, or a descriptive French error.
#[wasm_bindgen]
pub fn parse_and_verify_ticket_qr(
    qr_text: &str,
    public_key_hex: &str,
) -> Result<String, JsValue> {
    parse_and_verify_ticket_qr_impl(qr_text, public_key_hex).map_err(|e| JsValue::from_str(&e))
}

fn compress_receipt_image_impl(
    bytes: &[u8],
    max_width: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    if bytes.is_empty() {
        return Err("Image vide".to_string());
    }
    if max_width == 0 {
        return Err("La largeur maximale doit être supérieure à 0".to_string());
    }

    let format = image::guess_format(bytes)
        .map_err(|e| format!("Format d'image non reconnu: {e}"))?;
    if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP) {
        return Err(format!(
            "Format non supporté ({format:?}). Formats acceptés : PNG, JPEG, WebP"
        ));
    }

    let img = image::load_from_memory_with_format(bytes, format)
        .map_err(|e| format!("Échec décodage image: {e}"))?;

    let resized = resize_preserving_ratio(img, max_width);
    let rgb = to_rgb_white_background(&resized);

    let clamped_quality = quality.clamp(30, 95);
    let mut output = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut output, clamped_quality);
    encoder
        .encode_image(&rgb)
        .map_err(|e| format!("Échec encodage JPEG: {e}"))?;

    Ok(output)
}

fn resize_preserving_ratio(img: DynamicImage, max_width: u32) -> DynamicImage {
    let width = img.width();
    let height = img.height();
    if width <= max_width || width == 0 || height == 0 {
        return img;
    }

    let target_height =
        ((u64::from(height) * u64::from(max_width) + u64::from(width / 2)) / u64::from(width))
            .max(1) as u32;
    img.resize_exact(max_width, target_height, FilterType::Lanczos3)
}

fn to_rgb_white_background(img: &DynamicImage) -> RgbImage {
    if !img.color().has_alpha() {
        return img.to_rgb8();
    }

    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut rgb = RgbImage::new(w, h);
    for (x, y, px) in rgba.enumerate_pixels() {
        let alpha = u16::from(px[3]);
        let inv_alpha = 255 - alpha;
        let r = ((u16::from(px[0]) * alpha + 255 * inv_alpha + 127) / 255) as u8;
        let g = ((u16::from(px[1]) * alpha + 255 * inv_alpha + 127) / 255) as u8;
        let b = ((u16::from(px[2]) * alpha + 255 * inv_alpha + 127) / 255) as u8;
        rgb.put_pixel(x, y, Rgb([r, g, b]));
    }
    rgb
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BudgetEntryInput {
    #[serde(alias = "entry_type", alias = "kind")]
    r#type: String,
    #[serde(default, alias = "amount_cents")]
    amount_cents: Option<i64>,
    #[serde(default)]
    amount: Option<f64>,
    #[serde(default, alias = "categorie")]
    category: Option<String>,
    #[serde(default, alias = "projet", alias = "project_name", alias = "projectName")]
    project: Option<String>,
}

#[derive(Debug, Default)]
struct GroupAccumulator {
    income_cents: i64,
    expense_cents: i64,
    count: usize,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct GroupSummary {
    name: String,
    income_cents: i64,
    expense_cents: i64,
    balance_cents: i64,
    income: f64,
    expense: f64,
    balance: f64,
    count: usize,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct BudgetSummary {
    total_income_cents: i64,
    total_expense_cents: i64,
    balance_cents: i64,
    total_income: f64,
    total_expense: f64,
    balance: f64,
    entry_count: usize,
    by_category: Vec<GroupSummary>,
    by_project: Vec<GroupSummary>,
}

#[derive(Debug, Clone, Copy)]
enum EntryKind {
    Income,
    Expense,
}

fn parse_entry_kind(raw: &str) -> Result<EntryKind, String> {
    match raw.trim().to_lowercase().as_str() {
        "income" | "recette" | "recettes" | "credit" | "crédit" => Ok(EntryKind::Income),
        "expense" | "depense" | "dépense" | "depenses" | "dépenses" | "debit" | "débit" => {
            Ok(EntryKind::Expense)
        }
        other => Err(format!("Type d'écriture inconnu: '{other}'")),
    }
}

fn resolve_amount_cents(entry: &BudgetEntryInput) -> Result<i64, String> {
    if let Some(cents) = entry.amount_cents {
        if cents < 0 {
            return Err("Le montant en centimes ne peut pas être négatif".to_string());
        }
        return Ok(cents);
    }

    if let Some(euros) = entry.amount {
        if !euros.is_finite() || euros < 0.0 {
            return Err("Le montant en euros doit être un nombre fini positif ou nul".to_string());
        }
        return Ok((euros * 100.0).round() as i64);
    }

    Err("Montant manquant (amountCents ou amount requis)".to_string())
}

fn normalize_label(raw: Option<&str>, fallback: &str) -> String {
    match raw.map(str::trim) {
        Some(value) if !value.is_empty() => value.to_string(),
        _ => fallback.to_string(),
    }
}

fn cents_to_euros(cents: i64) -> f64 {
    cents as f64 / 100.0
}

fn finalize_groups(groups: BTreeMap<String, GroupAccumulator>) -> Vec<GroupSummary> {
    groups
        .into_iter()
        .map(|(name, acc)| {
            let balance_cents = acc.income_cents - acc.expense_cents;
            GroupSummary {
                name,
                income_cents: acc.income_cents,
                expense_cents: acc.expense_cents,
                balance_cents,
                income: cents_to_euros(acc.income_cents),
                expense: cents_to_euros(acc.expense_cents),
                balance: cents_to_euros(balance_cents),
                count: acc.count,
            }
        })
        .collect()
}

fn compute_budget_summary_impl(entries_json: &str) -> Result<String, String> {
    let entries: Vec<BudgetEntryInput> = serde_json::from_str(entries_json)
        .map_err(|e| format!("JSON budget invalide: {e}"))?;
    let summary = compute_budget_summary_from_entries(&entries)?;
    serde_json::to_string(&summary)
        .map_err(|e| format!("Erreur sérialisation résumé budget: {e}"))
}

fn compute_budget_summary_from_entries(entries: &[BudgetEntryInput]) -> Result<BudgetSummary, String> {
    let mut total_income_cents: i64 = 0;
    let mut total_expense_cents: i64 = 0;
    let mut by_category: BTreeMap<String, GroupAccumulator> = BTreeMap::new();
    let mut by_project: BTreeMap<String, GroupAccumulator> = BTreeMap::new();

    for entry in entries {
        let kind = parse_entry_kind(&entry.r#type)?;
        let amount_cents = resolve_amount_cents(entry)?;
        let category = normalize_label(entry.category.as_deref(), DEFAULT_CATEGORY);
        let project = normalize_label(entry.project.as_deref(), DEFAULT_PROJECT);

        let cat_acc = by_category.entry(category).or_default();
        let proj_acc = by_project.entry(project).or_default();

        match kind {
            EntryKind::Income => {
                total_income_cents = total_income_cents
                    .checked_add(amount_cents)
                    .ok_or_else(|| "Dépassement arithmétique sur le total des recettes".to_string())?;
                cat_acc.income_cents += amount_cents;
                proj_acc.income_cents += amount_cents;
            }
            EntryKind::Expense => {
                total_expense_cents = total_expense_cents
                    .checked_add(amount_cents)
                    .ok_or_else(|| "Dépassement arithmétique sur le total des dépenses".to_string())?;
                cat_acc.expense_cents += amount_cents;
                proj_acc.expense_cents += amount_cents;
            }
        }
        cat_acc.count += 1;
        proj_acc.count += 1;
    }

    let balance_cents = total_income_cents - total_expense_cents;

    Ok(BudgetSummary {
        total_income_cents,
        total_expense_cents,
        balance_cents,
        total_income: cents_to_euros(total_income_cents),
        total_expense: cents_to_euros(total_expense_cents),
        balance: cents_to_euros(balance_cents),
        entry_count: entries.len(),
        by_category: finalize_groups(by_category),
        by_project: finalize_groups(by_project),
    })
}

fn export_rows_to_csv_impl(headers_json: &str, rows_json: &str) -> Result<String, String> {
    let headers: Vec<String> = serde_json::from_str(headers_json)
        .map_err(|e| format!("En-têtes JSON invalides: {e}"))?;
    let rows: Vec<Vec<Value>> = serde_json::from_str(rows_json)
        .map_err(|e| format!("Lignes JSON invalides: {e}"))?;

    let mut out = String::from(UTF8_BOM);
    let mut lines: Vec<String> = Vec::with_capacity(rows.len() + 1);

    if !headers.is_empty() {
        let escaped_headers: Vec<String> = headers.iter().map(|h| escape_csv_field(h)).collect();
        lines.push(escaped_headers.join(&CSV_DELIMITER.to_string()));
    }

    for row in rows {
        let escaped_cells: Vec<String> = row
            .iter()
            .map(|val| escape_csv_field(&json_value_to_cell(val)))
            .collect();
        lines.push(escaped_cells.join(&CSV_DELIMITER.to_string()));
    }

    out.push_str(&lines.join("\r\n"));
    Ok(out)
}

fn json_value_to_cell(val: &Value) -> String {
    match val {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn escape_csv_field(field: &str) -> String {
    let needs_quotes = field.contains(CSV_DELIMITER)
        || field.contains('"')
        || field.contains('\n')
        || field.contains('\r');

    if !needs_quotes {
        return field.to_string();
    }

    let mut escaped = String::with_capacity(field.len() + 4);
    escaped.push('"');
    for ch in field.chars() {
        if ch == '"' {
            escaped.push_str("\"\"");
        } else {
            escaped.push(ch);
        }
    }
    escaped.push('"');
    escaped
}

fn decode_ed25519_public_key(public_key_hex: &str) -> Result<VerifyingKey, String> {
    let pk_bytes = hex::decode(public_key_hex.trim())
        .map_err(|_| "Clé publique Ed25519 invalide : hexadécimal mal formé".to_string())?;
    let pk_array: [u8; 32] = pk_bytes
        .try_into()
        .map_err(|_| "Clé publique Ed25519 invalide : exactement 32 octets requis".to_string())?;
    VerifyingKey::from_bytes(&pk_array)
        .map_err(|_| "Clé publique Ed25519 invalide : point de courbe rejeté".to_string())
}

fn parse_and_verify_ticket_qr_impl(qr_text: &str, public_key_hex: &str) -> Result<String, String> {
    let trimmed = qr_text.trim();
    let mut parts = trimmed.split('.');
    let prefix = parts.next();
    let payload_b64url = parts.next();
    let sig_b64url = parts.next();
    let extra = parts.next();

    if prefix != Some("MDL1")
        || payload_b64url.is_none_or(str::is_empty)
        || sig_b64url.is_none_or(str::is_empty)
        || extra.is_some()
    {
        return Err(
            "Format QR billet invalide : format attendu MDL1.<payload>.<signature>".to_string(),
        );
    }

    let payload_b64url = payload_b64url.unwrap_or_default();
    let sig_b64url = sig_b64url.unwrap_or_default();

    decode_ed25519_public_key(public_key_hex)?;

    if !verify_ticket_ed25519(payload_b64url, sig_b64url, public_key_hex) {
        return Err("Signature Ed25519 invalide ou billet falsifié".to_string());
    }

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64url)
        .map_err(|_| "Payload base64url du billet corrompu".to_string())?;
    let payload_json = String::from_utf8(payload_bytes)
        .map_err(|_| "Payload du billet non encodé en UTF-8 valide".to_string())?;
    serde_json::from_str::<Value>(&payload_json)
        .map_err(|_| "Payload du billet invalide : JSON mal formé".to_string())?;

    Ok(payload_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::codecs::png::PngEncoder;
    use image::{ColorType, ImageEncoder, Rgba, RgbaImage};
    use std::io::Cursor;

    fn make_test_png(width: u32, height: u32, with_alpha: bool) -> Vec<u8> {
        let mut png_bytes = Vec::new();
        if with_alpha {
            let mut img = RgbaImage::new(width, height);
            for (x, y, px) in img.enumerate_pixels_mut() {
                let alpha = if x < width / 2 { 128 } else { 255 };
                *px = Rgba([((x * 7) % 256) as u8, ((y * 11) % 256) as u8, 180, alpha]);
            }
            let encoder = PngEncoder::new(Cursor::new(&mut png_bytes));
            encoder
                .write_image(img.as_raw(), width, height, ColorType::Rgba8.into())
                .expect("PNG RGBA encoding should succeed");
        } else {
            let mut img = RgbImage::new(width, height);
            for (x, y, px) in img.enumerate_pixels_mut() {
                *px = Rgb([((x * 5) % 256) as u8, ((y * 9) % 256) as u8, 200]);
            }
            let encoder = PngEncoder::new(Cursor::new(&mut png_bytes));
            encoder
                .write_image(img.as_raw(), width, height, ColorType::Rgb8.into())
                .expect("PNG RGB encoding should succeed");
        }
        png_bytes
    }

    #[test]
    fn compress_receipt_resizes_and_outputs_valid_jpeg() {
        let png = make_test_png(2800, 1400, true);
        let jpeg = compress_receipt_image(&png, 1400, 80).expect("compression should succeed");

        assert!(jpeg.starts_with(&[0xFF, 0xD8, 0xFF]), "must be JPEG");
        assert_eq!(
            image::guess_format(&jpeg).expect("guess JPEG format"),
            ImageFormat::Jpeg
        );

        let decoded = image::load_from_memory(&jpeg).expect("decode compressed JPEG");
        assert_eq!(decoded.width(), 1400);
        assert_eq!(decoded.height(), 700);
    }

    #[test]
    fn compress_receipt_does_not_upscale_and_clamps_quality() {
        let small_png = make_test_png(600, 400, false);
        let jpeg_low_q = compress_receipt_image(&small_png, 1400, 5).expect("clamp low quality");
        let jpeg_high_q =
            compress_receipt_image(&small_png, 1400, 100).expect("clamp high quality");

        let decoded_low = image::load_from_memory(&jpeg_low_q).expect("decode low q");
        let decoded_high = image::load_from_memory(&jpeg_high_q).expect("decode high q");
        assert_eq!(decoded_low.width(), 600);
        assert_eq!(decoded_low.height(), 400);
        assert_eq!(decoded_high.width(), 600);
        assert!(
            jpeg_low_q.len() < jpeg_high_q.len(),
            "quality 30 output ({}) should be smaller than quality 95 ({})",
            jpeg_low_q.len(),
            jpeg_high_q.len()
        );
    }

    #[test]
    fn compress_receipt_rejects_invalid_inputs() {
        assert!(compress_receipt_image_impl(&[], 1400, 80).is_err());
        let png = make_test_png(100, 100, false);
        assert!(compress_receipt_image_impl(&png, 0, 80).is_err());
        assert!(compress_receipt_image_impl(b"not an image", 1400, 80).is_err());
    }

    #[test]
    fn budget_summary_computes_totals_and_breakdowns() {
        let json = r#"[
            {"type": "income", "amountCents": 15000, "category": "Adhésions", "project": "Fonctionnement"},
            {"type": "recette", "amount": 85.50, "category": "Ventes", "project": "Bal de promo"},
            {"type": "expense", "amountCents": 4200, "category": "Fournitures", "project": "Bal de promo"},
            {"type": "dépense", "amount": 13.50, "category": "", "project": null}
        ]"#;

        let summary_json = compute_budget_summary(json).expect("summary should succeed");
        let summary: BudgetSummary =
            serde_json::from_str(&summary_json).expect("valid summary JSON");

        assert_eq!(summary.entry_count, 4);
        assert_eq!(summary.total_income_cents, 23550);
        assert_eq!(summary.total_expense_cents, 5550);
        assert_eq!(summary.balance_cents, 18000);
        assert!((summary.balance - 180.0).abs() < f64::EPSILON);

        let bal = summary
            .by_project
            .iter()
            .find(|p| p.name == "Bal de promo")
            .expect("Bal de promo project present");
        assert_eq!(bal.income_cents, 8550);
        assert_eq!(bal.expense_cents, 4200);
        assert_eq!(bal.balance_cents, 4350);
        assert_eq!(bal.count, 2);

        assert!(summary
            .by_category
            .iter()
            .any(|c| c.name == DEFAULT_CATEGORY && c.expense_cents == 1350));
        assert!(summary
            .by_project
            .iter()
            .any(|p| p.name == DEFAULT_PROJECT && p.expense_cents == 1350));
    }

    #[test]
    fn budget_summary_handles_empty_and_errors() {
        let empty = compute_budget_summary("[]").expect("empty array valid");
        let parsed: BudgetSummary = serde_json::from_str(&empty).unwrap();
        assert_eq!(parsed.entry_count, 0);
        assert_eq!(parsed.balance_cents, 0);

        assert!(compute_budget_summary_impl(r#"[{"type":"unknown","amountCents":100}]"#).is_err());
        assert!(compute_budget_summary_impl(r#"[{"type":"income"}]"#).is_err());
        assert!(compute_budget_summary_impl("not-json").is_err());
    }

    #[test]
    fn export_csv_includes_bom_semicolon_and_rfc4180_escaping() {
        let headers = r#"["Date","Libellé; Détail","Montant (€)","Note"]"#;
        let rows = r#"[
            ["2026-11-13","Achat \"goûter\" lycéens",42.5,"Ligne 1\nLigne 2"],
            ["2026-11-14","Cotisation; espèce",5,null]
        ]"#;

        let csv = export_rows_to_csv(headers, rows).expect("CSV export should succeed");
        assert!(csv.starts_with('\u{FEFF}'), "must start with UTF-8 BOM");

        let without_bom = csv.trim_start_matches('\u{FEFF}');
        let expected = concat!(
            "Date;\"Libellé; Détail\";Montant (€);Note\r\n",
            "2026-11-13;\"Achat \"\"goûter\"\" lycéens\";42.5;\"Ligne 1\nLigne 2\"\r\n",
            "2026-11-14;\"Cotisation; espèce\";5;"
        );
        assert_eq!(without_bom, expected);
    }

    #[test]
    fn export_csv_rejects_invalid_json() {
        assert!(export_rows_to_csv_impl("invalid", "[]").is_err());
        assert!(export_rows_to_csv_impl("[]", "invalid").is_err());
    }

    #[test]
    fn ed25519_ticket_verification_succeeds_for_valid_signature() {
        use ed25519_dalek::{Signer, SigningKey};

        let secret_seed: [u8; 32] = [
            0x42, 0x11, 0x9c, 0x80, 0x55, 0x03, 0x77, 0xe1, 0x2a, 0x6f, 0xb4, 0x08, 0xd3, 0x91,
            0x4e, 0xbc, 0x19, 0x88, 0x30, 0x7a, 0xc5, 0x44, 0x61, 0xf0, 0x9e, 0x12, 0x3b, 0x57,
            0x8d, 0xaa, 0x01, 0xfe,
        ];
        let signing_key = SigningKey::from_bytes(&secret_seed);
        let public_key_hex = hex::encode(signing_key.verifying_key().to_bytes());

        let payload_json = r#"{"tid":104,"eid":7,"qrid":"mdl-qr-01","tier":"adherent","iat":1763051450}"#;
        let payload_b64url = URL_SAFE_NO_PAD.encode(payload_json.as_bytes());
        let signature = signing_key.sign(payload_b64url.as_bytes());
        let sig_b64url = URL_SAFE_NO_PAD.encode(signature.to_bytes());

        assert!(verify_ticket_ed25519(
            &payload_b64url,
            &sig_b64url,
            &public_key_hex
        ));

        let qr_text = format!("MDL1.{payload_b64url}.{sig_b64url}");
        let verified_json = parse_and_verify_ticket_qr_impl(&qr_text, &public_key_hex)
            .expect("valid ticket QR should verify");
        assert_eq!(verified_json, payload_json);
    }

    #[test]
    fn ed25519_ticket_verification_rejects_tampered_payload() {
        use ed25519_dalek::{Signer, SigningKey};

        let signing_key = SigningKey::from_bytes(&[0x7Au8; 32]);
        let public_key_hex = hex::encode(signing_key.verifying_key().to_bytes());

        let original_payload = r#"{"tid":12,"eid":3,"qrid":"qr-12","tier":"standard","iat":1763051450}"#;
        let original_b64url = URL_SAFE_NO_PAD.encode(original_payload.as_bytes());
        let signature = signing_key.sign(original_b64url.as_bytes());
        let sig_b64url = URL_SAFE_NO_PAD.encode(signature.to_bytes());

        let tampered_payload = r#"{"tid":12,"eid":3,"qrid":"qr-12","tier":"vip","iat":1763051450}"#;
        let tampered_b64url = URL_SAFE_NO_PAD.encode(tampered_payload.as_bytes());

        assert!(!verify_ticket_ed25519(
            &tampered_b64url,
            &sig_b64url,
            &public_key_hex
        ));

        let forged_qr = format!("MDL1.{tampered_b64url}.{sig_b64url}");
        let err = parse_and_verify_ticket_qr_impl(&forged_qr, &public_key_hex)
            .expect_err("tampered payload must be rejected");
        assert!(err.contains("Signature Ed25519 invalide"));
    }

    #[test]
    fn ed25519_ticket_verification_rejects_wrong_public_key_and_bad_formats() {
        use ed25519_dalek::{Signer, SigningKey};

        let signing_key = SigningKey::from_bytes(&[0x11u8; 32]);
        let wrong_key = SigningKey::from_bytes(&[0x22u8; 32]);
        let wrong_pk_hex = hex::encode(wrong_key.verifying_key().to_bytes());
        let right_pk_hex = hex::encode(signing_key.verifying_key().to_bytes());

        let payload_b64url = URL_SAFE_NO_PAD.encode(br#"{"tid":1,"eid":1,"qrid":"a","tier":"t","iat":1}"#);
        let sig_b64url = URL_SAFE_NO_PAD.encode(signing_key.sign(payload_b64url.as_bytes()).to_bytes());

        assert!(!verify_ticket_ed25519(
            &payload_b64url,
            &sig_b64url,
            &wrong_pk_hex
        ));
        assert!(!verify_ticket_ed25519(&payload_b64url, &sig_b64url, "abcd"));
        assert!(!verify_ticket_ed25519(&payload_b64url, "not_64_bytes", &right_pk_hex));

        let qr_text = format!("MDL1.{payload_b64url}.{sig_b64url}");
        assert!(parse_and_verify_ticket_qr_impl(&qr_text, &wrong_pk_hex).is_err());
        assert!(parse_and_verify_ticket_qr_impl("MDL2.abc.def", &right_pk_hex).is_err());
        assert!(parse_and_verify_ticket_qr_impl("MDL1.abc", &right_pk_hex).is_err());
        assert!(parse_and_verify_ticket_qr_impl("MDL1..def", &right_pk_hex).is_err());
    }
}
