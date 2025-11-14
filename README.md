# Product Sets Integration

Kompletní řešení pro integraci produktových setů mezi Shoptet a ESO9 systémy s využitím Google Cloud Platform.

## 📋 Přehled

Projekt automaticky:
1. Denně stahuje a zpracovává XML feedy z Shoptetu a ESO9
2. Ukládá data do BigQuery
3. Poskytuje rychlé HTTP API pro dotazování
4. Integruje se do Shoptetu pomocí JavaScriptu

## 🏗️ Architektura

```
┌─────────────┐     ┌─────────────┐
│   Shoptet   │     │    ESO9     │
│  XML Feed   │     │  XML Feed   │
└──────┬──────┘     └──────┬──────┘
       │                   │
       │ Daily (3:00)      │ Daily (3:15)
       ▼                   ▼
┌──────────────┐    ┌──────────────┐
│ Cloud Func   │    │ Cloud Func   │
│  (Shoptet)   │    │    (ESO)     │
└──────┬───────┘    └──────┬───────┘
       │                   │
       └─────────┬─────────┘
                 ▼
         ┌───────────────┐
         │   BigQuery    │
         │  - products   │
         │  - set_items  │
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │  Cloud Run    │
         │  Product API  │
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │   Shoptet     │
         │   Frontend    │
         └───────────────┘
```

## 📁 Struktura projektu

```
product-sets-project/
├── cloud-functions/
│   ├── import-shoptet/       # Cloud Function pro import Shoptet dat
│   │   ├── index.js
│   │   └── package.json
│   ├── import-eso/           # Cloud Function pro import ESO9 dat
│   │   ├── index.js
│   │   └── package.json
│   └── api/                  # Cloud Run API služba
│       ├── index.js
│       ├── package.json
│       └── Dockerfile
├── bigquery/
│   └── schema.sql            # BigQuery schéma
├── frontend/
│   ├── product-sets.js       # JavaScript pro Shoptet
│   └── product-sets.css      # CSS styly
├── terraform/
│   └── main.tf               # Infrastructure as Code
├── docs/
│   └── DEPLOYMENT.md         # Podrobný deployment guide
└── deploy.sh                 # Deployment skript
```

## 🚀 Rychlý start

### Předpoklady

- Google Cloud Platform účet
- Projekt `cm-monitoring` (nebo vlastní)
- gcloud CLI nainstalované
- Node.js 20+ (pro lokální testování)
- Terraform (volitelné)

### 1. Inicializace projektu

```bash
# Naklonovat/stáhnout projekt
cd product-sets-project

# Nastavit GCP projekt
gcloud config set project cm-monitoring
```

### 2. Vytvoření BigQuery schématu

```bash
# Spustit SQL skript
bq query --use_legacy_sql=false < bigquery/schema.sql
```

Nebo pomocí Terraformu:

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

### 3. Vytvoření secrets

```bash
# Shoptet XML URL
echo -n "https://www.chutmoravy.cz/export/productsComplete.xml?..." | \
  gcloud secrets create shoptet-xml-url --data-file=-

# ESO9 XML URL
echo -n "https://api.eso.cz/eso9api.shoptet/chutmoravy/sety.xml" | \
  gcloud secrets create eso-xml-url --data-file=-
```

### 4. Deployment

```bash
# Automatický deployment všeho
./deploy.sh
```

Nebo manuálně:

```bash
# Cloud Functions
cd cloud-functions/import-shoptet
gcloud functions deploy import-shoptet-products \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=importShoptetProducts \
  --trigger-http \
  --set-secrets=SHOPTET_XML_URL=shoptet-xml-url:latest

# Podobně pro import-eso

# Cloud Run API
cd cloud-functions/api
gcloud run deploy product-sets-api \
  --source=. \
  --region=us-central1 \
  --allow-unauthenticated
```

### 5. Testování

```bash
# Test Shoptet importu
curl https://REGION-PROJECT.cloudfunctions.net/import-shoptet-products

# Test ESO importu
curl https://REGION-PROJECT.cloudfunctions.net/import-eso-sets

# Test API
curl "https://API-URL/product-sets?productCode=CHM045"
```

### 6. Integrace do Shoptetu

1. V administraci Shoptetu přejděte na **Nastavení → Vlastní kód**
2. Přidejte CSS do `<head>`:

```html
<link rel="stylesheet" href="https://YOUR-CDN/product-sets.css">
```

3. Přidejte JavaScript před `</body>`:

```html
<script>
// Konfigurace
var PRODUCT_SETS_API_URL = 'https://YOUR-CLOUD-RUN-URL/product-sets';
</script>
<script src="https://YOUR-CDN/product-sets.js"></script>
```

## 📊 API Dokumentace

### GET /product-sets

Vrací seznam setů obsahujících daný produkt.

**Parametry:**
- `productCode` (povinný) - kód produktu

**Příklad požadavku:**
```bash
curl "https://api-url/product-sets?productCode=CHM045"
```

**Příklad odpovědi:**
```json
{
  "sets": [
    {
      "code": "BA195",
      "name": "Krmítko",
      "url": "https://www.chutmoravy.cz/krmitko/",
      "imgUrl": "https://cdn.myshoptet.com/.../image.jpg",
      "description": "Popis balíčku..."
    }
  ],
  "count": 1,
  "productCode": "CHM045",
  "queryTime": 45
}
```

### GET /set-detail

Vrací seznam produktů v daném setu.

**Parametry:**
- `setCode` (povinný) - kód setu

**Příklad požadavku:**
```bash
curl "https://api-url/set-detail?setCode=BA195"
```

**Příklad odpovědi:**
```json
{
  "set": {
    "code": "BA195",
    "name": "Krmítko",
    "url": "https://www.chutmoravy.cz/krmitko/",
    "imgUrl": "https://cdn.myshoptet.com/.../image.jpg",
    "description": "Popis setu..."
  },
  "items": [
    {
      "code": "CHM045",
      "amount": 1.0,
      "name": "Produkt 1",
      "url": "...",
      "imgUrl": "...",
      "description": "...",
      "availability": "in-stock"
    }
  ],
  "itemsCount": 3,
  "queryTime": 52
}
```

## 🔒 Zabezpečení

### CORS

API podporuje pouze požadavky z `www.chutmoravy.cz` a subdomén.

### Rate Limiting

- 500 požadavků za minutu na IP adresu
- Pomocí express-rate-limit middleware

### Secrets Management

- XML URL jsou uloženy v Google Secret Manager
- Nikdy nejsou hardcodované v kódu

## 📈 Monitoring a Logging

### Cloud Logging

Všechny funkce logují do Cloud Logging:

```bash
# Zobrazit logy importu
gcloud logging read "resource.type=cloud_function AND resource.labels.function_name=import-shoptet-products" --limit 50

# Zobrazit chyby
gcloud logging read "severity>=ERROR" --limit 20
```

### Metriky

Sledujte v Cloud Console:
- Počet spuštění funkcí
- Doba trvání
- Chybovost
- API latence

## 🔧 Údržba

### Ruční spuštění importu

```bash
# Spustit Shoptet import
gcloud scheduler jobs run import-shoptet-daily --location=us-central1

# Spustit ESO import
gcloud scheduler jobs run import-eso-daily --location=us-central1
```

### Kontrola dat v BigQuery

```sql
-- Počet produktů
SELECT COUNT(*) FROM `cm-monitoring.product_sets.products`;

-- Počet setů
SELECT COUNT(DISTINCT set_code) FROM `cm-monitoring.product_sets.set_items`;

-- Top 10 produktů v nejvíce setech
SELECT 
  item_code,
  COUNT(DISTINCT set_code) as sets_count
FROM `cm-monitoring.product_sets.set_items`
GROUP BY item_code
ORDER BY sets_count DESC
LIMIT 10;
```

### Aktualizace kódu

```bash
# Aktualizovat funkci
cd cloud-functions/import-shoptet
gcloud functions deploy import-shoptet-products ... # s novými parametry

# Aktualizovat API
cd cloud-functions/api
gcloud run deploy product-sets-api --source=.
```

## 🧪 Testování

### Lokální testování funkcí

```bash
cd cloud-functions/import-shoptet
npm install
npm test  # pokud jsou testy implementovány

# Lokální spuštění
export SHOPTET_XML_URL="https://..."
node -e "require('./index.js').importShoptetProducts({}, {status: () => ({json: console.log})})"
```

### Load testing API

```bash
# Pomocí Apache Bench
ab -n 1000 -c 10 "https://API-URL/product-sets?productCode=CHM045"

# Pomocí wrk
wrk -t10 -c100 -d60s "https://API-URL/product-sets?productCode=CHM045"
```

## 📝 Changelog

### v1.0.0 (2024-11-14)
- Iniciální implementace
- Cloud Functions pro ETL
- BigQuery schéma
- Cloud Run API
- Frontend integrace
- Terraform konfigurace

## 🤝 Podpora

Pro problémy a dotazy:
1. Zkontrolujte Cloud Logging pro chyby
2. Ověřte, že jsou secrets správně nastaveny
3. Otestujte API pomocí curl

## 📄 License

Proprietární - Chut Moravy

## 👥 Autoři

- Implementace: Claude + Development Team
- Specifikace: Chut Moravy Team
