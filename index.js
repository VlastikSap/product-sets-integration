const { BigQuery } = require('@google-cloud/bigquery');
const { Logging } = require('@google-cloud/logging');
const { XMLParser } = require('fast-xml-parser');
const fetch = require('node-fetch');

// Initialize clients
const bigquery = new BigQuery();
const logging = new Logging();
const log = logging.log('import-shoptet-products');

// Configuration from environment variables
const PROJECT_ID = process.env.GCP_PROJECT || 'cm-monitoring';
const DATASET_ID = 'product_sets';
const TABLE_ID = 'products';
const SHOPTET_XML_URL = process.env.SHOPTET_XML_URL;

/**
 * Clean HTML from text
 */
function cleanHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Extract first image URL from IMAGES element
 */
function extractFirstImage(images) {
  if (!images || !images.IMAGE) return null;
  
  if (Array.isArray(images.IMAGE)) {
    return images.IMAGE[0];
  }
  return images.IMAGE;
}

/**
 * Extract category IDs
 */
function extractCategories(categories) {
  if (!categories || !categories.CATEGORY) return [];
  
  const cats = Array.isArray(categories.CATEGORY) 
    ? categories.CATEGORY 
    : [categories.CATEGORY];
  
  return cats.map(cat => {
    if (typeof cat === 'object' && cat.id) return cat.id;
    return String(cat);
  });
}

/**
 * Parse Shoptet XML and transform to BigQuery schema
 */
function parseShoptetXml(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true
  });
  
  const result = parser.parse(xmlText);
  const items = result.SHOP?.SHOPITEM || [];
  const shopItems = Array.isArray(items) ? items : [items];
  
  return shopItems.map(item => {
    const productId = item['@_id'] ? parseInt(item['@_id']) : null;
    const code = item.CODE || null;
    
    // Skip items without CODE
    if (!code) return null;
    
    const imageUrl = extractFirstImage(item.IMAGES);
    const categoryIds = extractCategories(item.CATEGORIES);
    
    return {
      product_code: code,
      product_id: productId,
      name: item.NAME || '',
      url: item.URL || '',
      img_url: imageUrl || '',
      short_description: cleanHtml(item.SHORT_DESCRIPTION || ''),
      description_html: item.DESCRIPTION || '',
      visibility: item.VISIBILITY || 'visible',
      availability: item.AVAILABILITY || 'unknown',
      category_ids: categoryIds,
      raw_xml: JSON.stringify(item),
      updated_at: new Date().toISOString()
    };
  }).filter(item => item !== null);
}

/**
 * Load data into BigQuery using WRITE_TRUNCATE (replace table)
 */
async function loadToBigQuery(rows) {
  const dataset = bigquery.dataset(DATASET_ID);
  const table = dataset.table(TABLE_ID);
  
  // Insert rows with WRITE_TRUNCATE to replace existing data
  const [job] = await table.load(rows, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_TRUNCATE',
    schema: {
      fields: [
        { name: 'product_code', type: 'STRING', mode: 'REQUIRED' },
        { name: 'product_id', type: 'INTEGER', mode: 'NULLABLE' },
        { name: 'name', type: 'STRING', mode: 'NULLABLE' },
        { name: 'url', type: 'STRING', mode: 'NULLABLE' },
        { name: 'img_url', type: 'STRING', mode: 'NULLABLE' },
        { name: 'short_description', type: 'STRING', mode: 'NULLABLE' },
        { name: 'description_html', type: 'STRING', mode: 'NULLABLE' },
        { name: 'visibility', type: 'STRING', mode: 'NULLABLE' },
        { name: 'availability', type: 'STRING', mode: 'NULLABLE' },
        { name: 'category_ids', type: 'STRING', mode: 'REPEATED' },
        { name: 'raw_xml', type: 'STRING', mode: 'NULLABLE' },
        { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
      ]
    }
  });
  
  // Wait for job completion
  await job.promise();
  
  const metadata = job.metadata;
  return {
    jobId: metadata.id,
    status: metadata.status.state,
    rowsLoaded: metadata.statistics.load.outputRows
  };
}

/**
 * HTTP Cloud Function entry point
 */
exports.importShoptetProducts = async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Log start
    await log.write(log.entry({
      severity: 'INFO',
      message: 'Starting Shoptet products import'
    }));
    
    // Validate configuration
    if (!SHOPTET_XML_URL) {
      throw new Error('SHOPTET_XML_URL environment variable is not set');
    }
    
    // Step 1: Download XML
    console.log('Downloading XML from:', SHOPTET_XML_URL);
    const response = await fetch(SHOPTET_XML_URL);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch XML: ${response.status} ${response.statusText}`);
    }
    
    const xmlText = await response.text();
    console.log(`Downloaded XML: ${xmlText.length} bytes`);
    
    // Step 2: Parse XML
    console.log('Parsing XML...');
    const products = parseShoptetXml(xmlText);
    console.log(`Parsed ${products.length} products`);
    
    if (products.length === 0) {
      await log.write(log.entry({
        severity: 'WARNING',
        message: 'No products found in XML'
      }));
      
      res.status(200).json({
        success: true,
        message: 'No products to import',
        productsCount: 0,
        duration: Date.now() - startTime
      });
      return;
    }
    
    // Step 3: Load to BigQuery
    console.log('Loading to BigQuery...');
    const result = await loadToBigQuery(products);
    
    // Log success
    await log.write(log.entry({
      severity: 'INFO',
      message: 'Shoptet products import completed successfully',
      data: {
        productsCount: products.length,
        rowsLoaded: result.rowsLoaded,
        jobId: result.jobId,
        duration: Date.now() - startTime
      }
    }));
    
    res.status(200).json({
      success: true,
      message: 'Import completed successfully',
      productsCount: products.length,
      rowsLoaded: result.rowsLoaded,
      jobId: result.jobId,
      duration: Date.now() - startTime
    });
    
  } catch (error) {
    console.error('Import failed:', error);
    
    // Log error
    await log.write(log.entry({
      severity: 'ERROR',
      message: 'Shoptet products import failed',
      data: {
        error: error.message,
        stack: error.stack,
        duration: Date.now() - startTime
      }
    }));
    
    res.status(500).json({
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    });
  }
};
