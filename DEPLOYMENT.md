# Deployment Guide - Product Sets Integration

Tento dokument obsahuje podrobný postup pro deployment celého systému.

## Příprava před deploymentem

### 1. GCP Projekt Setup

```bash
# Vytvořit nový projekt (pokud ještě neexistuje)
gcloud projects create cm-monitoring --name="CM Monitoring"

# Nastavit jako aktivní
gcloud config set project cm-monitoring

# Propojit s billing účtem
gcloud beta billing projects link cm-monitoring --billing-account=BILLING_ACCOUNT_ID
```

### 2. Povolit API

```bash
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudscheduler.googleapis.com  
gcloud services enable run.googleapis.com
gcloud services enable bigquery.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable logging.googleapis.com
```

### 3. Vytvořit Service Accounts

```bash
# Pro import funkce
gcloud iam service-accounts create import-functions-sa \
  --display-name="Import Functions Service Account"

# Pro API
gcloud iam service-accounts create product-sets-api-sa \
  --display-name="Product Sets API Service Account"

# Přiřadit role
gcloud projects add-iam-policy-binding cm-monitoring \
  --member="serviceAccount:import-functions-sa@cm-monitoring.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"

gcloud projects add-iam-policy-binding cm-monitoring \
  --member="serviceAccount:import-functions-sa@cm-monitoring.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

gcloud projects add-iam-policy-binding cm-monitoring \
  --member="serviceAccount:product-sets-api-sa@cm-monitoring.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding cm-monitoring \
  --member="serviceAccount:product-sets-api-sa@cm-monitoring.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"
```

## Krok 1: BigQuery Setup

### Pomocí gcloud a bq CLI

```bash
# Vytvořit dataset
bq mk \
  --dataset \
  --location=US \
  --description="Product sets data from Shoptet and ESO9" \
  cm-monitoring:product_sets

# Vytvořit products tabulku
bq mk \
  --table \
  cm-monitoring:product_sets.products \
  bigquery/products_schema.json

# Vytvořit set_items tabulku
bq mk \
  --table \
  cm-monitoring:product_sets.set_items \
  bigquery/set_items_schema.json

# Vytvořit view
bq mk \
  --use_legacy_sql=false \
  --view="$(cat bigquery/view_query.sql)" \
  cm-monitoring:product_sets.product_sets_view
```

### Nebo pomocí Terraform

```bash
cd terraform

# Inicializovat
terraform init

# Vytvořit terraform.tfvars
cat > terraform.tfvars <<EOF
project_id = "cm-monitoring"
region = "us-central1"
shoptet_xml_url = "https://www.chutmoravy.cz/export/productsComplete.xml?..."
eso_xml_url = "https://api.eso.cz/eso9api.shoptet/chutmoravy/sety.xml"
EOF

# Zkontrolovat plán
terraform plan

# Aplikovat
terraform apply
```

## Krok 2: Secret Manager Setup

```bash
# Vytvořit secret pro Shoptet URL
echo -n "https://www.chutmoravy.cz/export/productsComplete.xml?patternId=-5&partnerId=27&hash=YOUR_HASH" | \
  gcloud secrets create shoptet-xml-url \
  --data-file=- \
  --replication-policy="automatic"

# Vytvořit secret pro ESO URL
echo -n "https://api.eso.cz/eso9api.shoptet/chutmoravy/sety.xml" | \
  gcloud secrets create eso-xml-url \
  --data-file=- \
  --replication-policy="automatic"

# Dát přístup service accountu k secrets
gcloud secrets add-iam-policy-binding shoptet-xml-url \
  --member="serviceAccount:import-functions-sa@cm-monitoring.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding eso-xml-url \
  --member="serviceAccount:import-functions-sa@cm-monitoring.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Krok 3: Deploy Cloud Functions

### Import Shoptet Products

```bash
cd cloud-functions/import-shoptet

gcloud functions deploy import-shoptet-products \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=importShoptetProducts \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=512Mi \
  --max-instances=10 \
  --service-account=import-functions-sa@cm-monitoring.iam.gserviceaccount.com \
  --set-env-vars=GCP_PROJECT=cm-monitoring \
  --set-secrets=SHOPTET_XML_URL=shoptet-xml-url:latest

# Získat URL funkce
SHOPTET_FUNCTION_URL=$(gcloud functions describe import-shoptet-products \
  --gen2 \
  --region=us-central1 \
  --format='value(serviceConfig.uri)')

echo "Shoptet function URL: $SHOPTET_FUNCTION_URL"
```

### Import ESO Sets

```bash
cd ../import-eso

gcloud functions deploy import-eso-sets \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=importEsoSets \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=512Mi \
  --max-instances=10 \
  --service-account=import-functions-sa@cm-monitoring.iam.gserviceaccount.com \
  --set-env-vars=GCP_PROJECT=cm-monitoring \
  --set-secrets=ESO_XML_URL=eso-xml-url:latest

# Získat URL funkce
ESO_FUNCTION_URL=$(gcloud functions describe import-eso-sets \
  --gen2 \
  --region=us-central1 \
  --format='value(serviceConfig.uri)')

echo "ESO function URL: $ESO_FUNCTION_URL"
```

## Krok 4: Deploy Cloud Run API

```bash
cd ../api

# Build a deploy
gcloud run deploy product-sets-api \
  --source=. \
  --platform=managed \
  --region=us-central1 \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=100 \
  --service-account=product-sets-api-sa@cm-monitoring.iam.gserviceaccount.com \
  --set-env-vars=GCP_PROJECT=cm-monitoring,ALLOWED_ORIGIN=https://www.chutmoravy.cz \
  --port=8080

# Získat URL API
API_URL=$(gcloud run services describe product-sets-api \
  --region=us-central1 \
  --format='value(status.url)')

echo "API URL: $API_URL"
```

### Volitelně: Nastavit Cloud CDN

```bash
# Vytvořit backend bucket pro statické soubory
gcloud compute backend-buckets create product-sets-static \
  --gcs-bucket-name=cm-monitoring-static \
  --enable-cdn

# Vytvořit load balancer s Cloud CDN
# (Komplexnější setup - viz GCP dokumentace)
```

## Krok 5: Setup Cloud Scheduler

```bash
# Shoptet import - denně v 3:00
gcloud scheduler jobs create http import-shoptet-daily \
  --location=us-central1 \
  --schedule="0 3 * * *" \
  --uri="$SHOPTET_FUNCTION_URL" \
  --http-method=GET \
  --time-zone="Europe/Prague" \
  --attempt-deadline=540s

# ESO import - denně v 3:15 (15 minut po Shoptet)
gcloud scheduler jobs create http import-eso-daily \
  --location=us-central1 \
  --schedule="15 3 * * *" \
  --uri="$ESO_FUNCTION_URL" \
  --http-method=GET \
  --time-zone="Europe/Prague" \
  --attempt-deadline=540s
```

## Krok 6: První import dat

```bash
# Spustit manuálně první import
curl "$SHOPTET_FUNCTION_URL"

# Počkat 1-2 minuty a pak spustit ESO import
curl "$ESO_FUNCTION_URL"

# Zkontrolovat data v BigQuery
bq query --use_legacy_sql=false \
  "SELECT COUNT(*) as products_count FROM \`cm-monitoring.product_sets.products\`"

bq query --use_legacy_sql=false \
  "SELECT COUNT(*) as set_items_count FROM \`cm-monitoring.product_sets.set_items\`"
```

## Krok 7: Test API

```bash
# Test health check
curl "$API_URL/health"

# Test s reálným produktem
curl "$API_URL/product-sets?productCode=CHM045" | jq

# Test set detail
curl "$API_URL/set-detail?setCode=BA195" | jq
```

## Krok 8: Frontend integrace

### A) Upload do CDN / statického hostingu

```bash
# Nahrát soubory do GCS bucket
gsutil cp frontend/product-sets.js gs://cm-monitoring-static/js/
gsutil cp frontend/product-sets.css gs://cm-monitoring-static/css/

# Nastavit public přístup
gsutil iam ch allUsers:objectViewer gs://cm-monitoring-static
```

### B) Integrace do Shoptetu

1. Přihlaste se do administrace Shoptetu
2. Přejděte na **Nastavení → Vlastní kód v zápatí**
3. Přidejte do sekce `<head>`:

```html
<link rel="stylesheet" href="https://storage.googleapis.com/cm-monitoring-static/css/product-sets.css">
```

4. Přidejte před `</body>`:

```html
<script>
// Konfigurace API URL
(function() {
  if (typeof jQuery === 'undefined') {
    console.error('jQuery is required for Product Sets');
    return;
  }
  
  // Nahradit YOUR-CLOUD-RUN-URL skutečnou URL
  window.PRODUCT_SETS_CONFIG = {
    apiUrl: 'https://YOUR-CLOUD-RUN-URL/product-sets',
    debug: false
  };
})();
</script>
<script src="https://storage.googleapis.com/cm-monitoring-static/js/product-sets.js"></script>
```

5. **Důležité:** Nahraďte `YOUR-CLOUD-RUN-URL` skutečnou URL z kroku 4

## Krok 9: Monitoring Setup

### Cloud Monitoring Dashboards

```bash
# Vytvořit upozornění na selhání importu
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Import Function Failures" \
  --condition-display-name="High Error Rate" \
  --condition-threshold-value=1 \
  --condition-threshold-duration=300s \
  --condition-filter='resource.type="cloud_function" AND metric.type="cloudfunctions.googleapis.com/function/execution_count" AND metric.label.status!="ok"'
```

### Log-based Metrics

```bash
# Vytvořit metriku pro sledování počtu importovaných produktů
gcloud logging metrics create imported_products_count \
  --description="Number of products imported" \
  --log-filter='resource.type="cloud_function" AND jsonPayload.message="Import completed successfully"' \
  --value-extractor='EXTRACT(jsonPayload.productsCount)'
```

## Troubleshooting

### Cloud Functions nefungují

```bash
# Zkontrolovat logy
gcloud functions logs read import-shoptet-products --limit=50

# Zkontrolovat secrets
gcloud secrets versions access latest --secret=shoptet-xml-url

# Test lokálně
cd cloud-functions/import-shoptet
export SHOPTET_XML_URL="https://..."
node index.js
```

### API vrací chyby

```bash
# Zkontrolovat Cloud Run logy
gcloud logging read "resource.type=cloud_run_revision" --limit=50

# Zkontrolovat revize
gcloud run revisions list --service=product-sets-api --region=us-central1

# Rollback na předchozí verzi
gcloud run services update-traffic product-sets-api \
  --to-revisions=REVISION_NAME=100 \
  --region=us-central1
```

### BigQuery dotazy jsou pomalé

```sql
-- Přidat clustering
CREATE OR REPLACE TABLE `cm-monitoring.product_sets.products`
CLUSTER BY product_code AS
SELECT * FROM `cm-monitoring.product_sets.products`;

-- Analyzovat query plan
bq query --use_legacy_sql=false --dry_run \
  "SELECT * FROM \`cm-monitoring.product_sets.product_sets_view\` WHERE product_code = 'CHM045'"
```

## Údržba

### Aktualizace kódu

```bash
# Cloud Functions - jen nahrajte novou verzi
gcloud functions deploy import-shoptet-products ...

# Cloud Run - automatický rebuild
gcloud run deploy product-sets-api --source=.
```

### Monitoring nákladů

```bash
# Zobrazit náklady
gcloud billing accounts list
gcloud alpha billing projects describe cm-monitoring

# Nastavit budget alert
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="Product Sets Budget" \
  --budget-amount=100USD \
  --threshold-rule=percent=50,80,100
```

## Bezpečnostní doporučení

1. **Nikdy** necommitujte API klíče nebo URL s hashem do Gitu
2. Používejte Secret Manager pro citlivé hodnoty
3. Pravidelně rotujte secrets
4. Sledujte přístupové logy
5. Používejte service accounts s minimálními právy
6. Zapněte Cloud Armor pro DDoS ochranu (volitelně)

## Další kroky

- [ ] Nastavit alerting
- [ ] Vytvořit backup politiku pro BigQuery
- [ ] Implementovat cache warming
- [ ] Přidat A/B testování
- [ ] Sledovat conversion metriky
