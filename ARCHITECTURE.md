# Architecture Documentation

## System Overview

Product Sets Integration je cloudové řešení pro automatickou synchronizaci a publikaci produktových setů mezi Shoptet e-shopem a ESO9 ERP systémem.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Data Sources                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────┐              ┌─────────────────┐              │
│  │  Shoptet XML     │              │   ESO9 XML      │              │
│  │  Products Feed   │              │   Sets Feed     │              │
│  │                  │              │                 │              │
│  │ productsComplete │              │    sety.xml     │              │
│  └────────┬─────────┘              └────────┬────────┘              │
│           │                                 │                        │
└───────────┼─────────────────────────────────┼────────────────────────┘
            │                                 │
            │ HTTPS                           │ HTTPS
            │ Daily 03:00                     │ Daily 03:15
            ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ETL Layer (Cloud Functions)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────┐              ┌─────────────────┐              │
│  │ import-shoptet   │              │   import-eso    │              │
│  │   -products      │              │     -sets       │              │
│  │                  │              │                 │              │
│  │ • Download XML   │              │ • Download XML  │              │
│  │ • Parse data     │              │ • Parse sets    │              │
│  │ • Transform      │              │ • Extract items │              │
│  │ • Load to BQ     │              │ • Load to BQ    │              │
│  └────────┬─────────┘              └────────┬────────┘              │
│           │                                 │                        │
│           │ Triggered by                    │ Triggered by          │
│           │ Cloud Scheduler                 │ Cloud Scheduler       │
└───────────┼─────────────────────────────────┼────────────────────────┘
            │                                 │
            └─────────────┬───────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Data Layer (BigQuery)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Dataset: cm-monitoring.product_sets                                 │
│                                                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │    products      │  │    set_items     │  │ product_sets_view│  │
│  │                  │  │                  │  │                  │  │
│  │ • product_code   │  │ • set_code       │  │ JOIN view for    │  │
│  │ • product_id     │  │ • item_code      │  │ quick queries    │  │
│  │ • name           │  │ • amount         │  │                  │  │
│  │ • url            │  │ • updated_at     │  │ Clusters by      │  │
│  │ • img_url        │  │                  │  │ product_code     │  │
│  │ • description    │  │ PK: (set_code,   │  │                  │  │
│  │ • availability   │  │      item_code)  │  │                  │  │
│  │ • category_ids[] │  │                  │  │                  │  │
│  │ • updated_at     │  │                  │  │                  │  │
│  │                  │  │                  │  │                  │  │
│  │ PK: product_code │  │                  │  │                  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                │ SQL Queries
                                │ < 100ms latency
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      API Layer (Cloud Run)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              product-sets-api                                  │  │
│  │                                                                │  │
│  │  Express.js Server                                             │  │
│  │                                                                │  │
│  │  Endpoints:                                                    │  │
│  │  • GET /health                                                 │  │
│  │  • GET /product-sets?productCode=XXX                           │  │
│  │  • GET /set-detail?setCode=XXX                                 │  │
│  │                                                                │  │
│  │  Features:                                                     │  │
│  │  • CORS protection (www.chutmoravy.cz)                         │  │
│  │  • Rate limiting (500 req/min)                                 │  │
│  │  • Cache headers (1 hour)                                      │  │
│  │  • Auto-scaling (0-10 instances)                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                │ HTTPS + CDN (optional)
                                │ JSON responses
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Presentation Layer (Shoptet)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Product Detail Page                               │  │
│  │                                                                │  │
│  │  JavaScript Integration:                                       │  │
│  │  • Detects product code from dataLayer                         │  │
│  │  • Fetches sets via AJAX                                       │  │
│  │  • Renders gift sets section                                   │  │
│  │                                                                │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  Dárkové balíčky s tímto produktem                      │  │  │
│  │  │                                                          │  │  │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐                      │  │  │
│  │  │  │ Set 1  │ │ Set 2  │ │ Set 3  │  ...                 │  │  │
│  │  │  │ Image  │ │ Image  │ │ Image  │                      │  │  │
│  │  │  │ Name   │ │ Name   │ │ Name   │                      │  │  │
│  │  │  │ Desc   │ │ Desc   │ │ Desc   │                      │  │  │
│  │  │  └────────┘ └────────┘ └────────┘                      │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Daily ETL Process

```
03:00 CET - Cloud Scheduler triggers Shoptet import
           ↓
      Cloud Function downloads productsComplete.xml
           ↓
      Parse XML (fast-xml-parser)
           ↓
      Transform to BigQuery schema
           ↓
      WRITE_TRUNCATE to products table
           ↓
      Log success/failure

03:15 CET - Cloud Scheduler triggers ESO import
           ↓
      Cloud Function downloads sety.xml
           ↓
      Parse XML for sets and items
           ↓
      Transform to BigQuery schema
           ↓
      WRITE_TRUNCATE to set_items table
           ↓
      Log success/failure
```

### 2. API Request Flow

```
User visits product detail page
           ↓
JavaScript extracts productCode
           ↓
AJAX GET /product-sets?productCode=XXX
           ↓
Cloud Run API receives request
           ↓
Rate limit check (500/min)
           ↓
CORS validation
           ↓
Query BigQuery view:
  SELECT * FROM product_sets_view
  WHERE product_code = @productCode
           ↓
Transform to JSON response
           ↓
Set Cache-Control: max-age=3600
           ↓
Return JSON to frontend
           ↓
JavaScript renders sets
```

## Key Components

### 1. Cloud Functions (ETL)

**Technology Stack:**
- Runtime: Node.js 20
- Parser: fast-xml-parser
- Storage: BigQuery Node.js SDK
- Logging: Cloud Logging SDK

**Configuration:**
- Memory: 512 MB
- Timeout: 540s (9 minutes)
- Max instances: 10
- Trigger: HTTP + Cloud Scheduler

**Scalability:**
- Handles XML files up to 50MB
- Processes 10,000+ products efficiently
- Automatic retry on failure

### 2. BigQuery (Data Warehouse)

**Schema Design:**
- Normalized structure
- Denormalized view for performance
- Clustering by product_code
- No partitioning (data size < 10GB)

**Performance:**
- Query latency: < 100ms
- Data freshness: Daily updates
- Storage cost: ~$0.02/GB/month
- Query cost: $5/TB scanned

### 3. Cloud Run API

**Technology Stack:**
- Runtime: Node.js 20 on Docker
- Framework: Express.js
- Middleware: Helmet, CORS, Rate Limiter
- Client: BigQuery Node.js SDK

**Configuration:**
- Memory: 512 MB
- CPU: 1
- Min instances: 0 (scales to zero)
- Max instances: 10
- Concurrency: 100 requests/instance

**Performance Targets:**
- Response time: < 200ms (P95)
- Throughput: 500+ req/min
- Availability: 99.9%

### 4. Frontend Integration

**Technology Stack:**
- jQuery (pre-loaded in Shoptet)
- Vanilla JavaScript
- CSS3 with Grid layout

**Features:**
- Progressive enhancement
- Error handling
- Loading states
- Responsive design

## Security Architecture

### Authentication & Authorization

```
Cloud Scheduler
    ↓ (Service Account)
Cloud Functions
    ↓ (Service Account: import-functions-sa)
    ↓ Roles: bigquery.dataEditor, bigquery.jobUser
BigQuery

Frontend
    ↓ (Public HTTPS)
Cloud Run API
    ↓ (Service Account: product-sets-api-sa)
    ↓ Roles: bigquery.dataViewer, bigquery.jobUser
BigQuery
```

### Secret Management

```
Developer → Secret Manager
                ↓
           Create secret
                ↓
           Grant IAM access
                ↓
         Cloud Function
                ↓
         Read at runtime
```

### Network Security

- **CORS:** Restricted to www.chutmoravy.cz
- **Rate Limiting:** 500 req/min per IP
- **HTTPS:** Enforced on all endpoints
- **No Authentication:** Public read-only API

## Monitoring & Observability

### Logging

```
Cloud Functions → Cloud Logging
    ↓
Log Entries:
- Start/end of import
- Number of records processed
- Errors and stack traces
- Performance metrics

Cloud Run → Cloud Logging
    ↓
Log Entries:
- HTTP requests
- Query performance
- Errors
- Cache hits
```

### Metrics

```
Cloud Monitoring Dashboards:
- Function execution count
- Function duration
- Function errors
- API request rate
- API latency (P50, P95, P99)
- BigQuery bytes scanned
- BigQuery slots used
```

### Alerting

```
Alert Policies:
- Import function failures
- API error rate > 5%
- API latency > 1000ms
- BigQuery query errors
```

## Cost Estimation

### Monthly Costs (estimated)

**BigQuery:**
- Storage (10 GB): $0.20
- Queries (10 GB/day × 30): $1.50
- Total: **$1.70/month**

**Cloud Functions:**
- Invocations (2/day × 30): $0.00 (free tier)
- Compute time: $0.10
- Total: **$0.10/month**

**Cloud Run:**
- Container instances: $2.00
- Requests (500/min × 60 × 24 × 30 = 21.6M): $0.40
- Total: **$2.40/month**

**Cloud Scheduler:**
- Jobs (2 × 30): $0.00 (free tier)
- Total: **$0.00/month**

**Total Estimated Cost: ~$5/month**

## Scalability

### Current Capacity

- **Data:** 100,000 products, 10,000 sets
- **API:** 500 requests/min (30,000/hour)
- **Storage:** Up to 1 TB in BigQuery
- **Processing:** 50 MB XML files

### Growth Path

**To 1,000 req/min:**
- Increase Cloud Run max instances to 20
- Add Cloud CDN
- Cost: ~$10/month

**To 10,000 req/min:**
- Add Cloud CDN (required)
- Increase Cloud Run to 50 instances
- Consider Cloud Armor for DDoS
- Cost: ~$50/month

**To 1M products:**
- Enable BigQuery partitioning
- Optimize queries with materialized views
- Cost: ~$20/month (storage + queries)

## Disaster Recovery

### Backup Strategy

**BigQuery:**
- Automatic 7-day snapshots
- Manual exports to Cloud Storage (optional)
- Recovery time: Minutes

**Cloud Functions & Cloud Run:**
- Source code in Git
- Infrastructure as Code (Terraform)
- Recovery time: < 30 minutes

### Failure Scenarios

**XML feed unavailable:**
- Function logs error
- Keeps previous data
- Alert sent
- Manual intervention required

**BigQuery unavailable:**
- Automatic retries (3 attempts)
- Falls back to cached data
- Alert sent

**API unavailable:**
- Cloud Run auto-restarts
- Traffic shifts to healthy instances
- Recovery: Automatic (seconds)

## Future Enhancements

1. **Real-time Updates:** Webhook-based updates instead of daily batch
2. **Caching Layer:** Redis/Memorystore for sub-10ms responses
3. **Advanced Analytics:** Product recommendations, trending sets
4. **A/B Testing:** Test different set presentations
5. **Personalization:** User-specific set recommendations
6. **Mobile App:** Native API for mobile applications
7. **Multi-region:** Deploy to EU and US regions
8. **GraphQL API:** More flexible querying

## Maintenance Schedule

- **Daily:** Automatic data imports
- **Weekly:** Review logs and metrics
- **Monthly:** Cost analysis, performance review
- **Quarterly:** Security audit, dependency updates
- **Yearly:** Architecture review, capacity planning
