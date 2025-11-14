const { BigQuery } = require('@google-cloud/bigquery');
const { Logging } = require('@google-cloud/logging');
const { XMLParser } = require('fast-xml-parser');
const fetch = require('node-fetch');

// Initialize clients
const bigquery = new BigQuery();
const logging = new Logging();
const log = logging.log('import-eso-sets');

// Configuration from environment variables
const PROJECT_ID = process.env.GCP_PROJECT || 'cm-monitoring';
const DATASET_ID = 'product_sets';
const TABLE_ID = 'set_items';
const ESO_XML_URL = process.env.ESO_XML_URL;

/**
 * Parse ESO9 sets XML and transform to BigQuery schema
 */
function parseEsoSetsXml(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true
  });
  
  const result = parser.parse(xmlText);
  const items = result.SHOP?.SHOPITEM || [];
  const shopItems = Array.isArray(items) ? items : [items];
  
  const setItems = [];
  
  for (const item of shopItems) {
    const setCode = item.CODE;
    
    // Skip items without CODE
    if (!setCode) continue;
    
    // Skip items without SET_ITEMS
    if (!item.SET_ITEMS || !item.SET_ITEMS.SET_ITEM) continue;
    
    const setItemsArray = Array.isArray(item.SET_ITEMS.SET_ITEM)
      ? item.SET_ITEMS.SET_ITEM
      : [item.SET_ITEMS.SET_ITEM];
    
    for (const setItem of setItemsArray) {
      const itemCode = setItem.CODE;
      const amount = setItem.AMOUNT ? parseFloat(setItem.AMOUNT) : 1.0;
      
      if (itemCode) {
        setItems.push({
          set_code: setCode,
          item_code: itemCode,
          amount: amount,
          updated_at: new Date().toISOString()
        });
      }
    }
  }
  
  return setItems;
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
        { name: 'set_code', type: 'STRING', mode: 'REQUIRED' },
        { name: 'item_code', type: 'STRING', mode: 'REQUIRED' },
        { name: 'amount', type: 'FLOAT', mode: 'NULLABLE' },
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
exports.importEsoSets = async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Log start
    await log.write(log.entry({
      severity: 'INFO',
      message: 'Starting ESO9 sets import'
    }));
    
    // Validate configuration
    if (!ESO_XML_URL) {
      throw new Error('ESO_XML_URL environment variable is not set');
    }
    
    // Step 1: Download XML
    console.log('Downloading XML from:', ESO_XML_URL);
    const response = await fetch(ESO_XML_URL);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch XML: ${response.status} ${response.statusText}`);
    }
    
    const xmlText = await response.text();
    console.log(`Downloaded XML: ${xmlText.length} bytes`);
    
    // Step 2: Parse XML
    console.log('Parsing XML...');
    const setItems = parseEsoSetsXml(xmlText);
    console.log(`Parsed ${setItems.length} set items`);
    
    if (setItems.length === 0) {
      await log.write(log.entry({
        severity: 'WARNING',
        message: 'No set items found in XML'
      }));
      
      res.status(200).json({
        success: true,
        message: 'No set items to import',
        setItemsCount: 0,
        duration: Date.now() - startTime
      });
      return;
    }
    
    // Step 3: Load to BigQuery
    console.log('Loading to BigQuery...');
    const result = await loadToBigQuery(setItems);
    
    // Log success
    await log.write(log.entry({
      severity: 'INFO',
      message: 'ESO9 sets import completed successfully',
      data: {
        setItemsCount: setItems.length,
        rowsLoaded: result.rowsLoaded,
        jobId: result.jobId,
        duration: Date.now() - startTime
      }
    }));
    
    res.status(200).json({
      success: true,
      message: 'Import completed successfully',
      setItemsCount: setItems.length,
      rowsLoaded: result.rowsLoaded,
      jobId: result.jobId,
      duration: Date.now() - startTime
    });
    
  } catch (error) {
    console.error('Import failed:', error);
    
    // Log error
    await log.write(log.entry({
      severity: 'ERROR',
      message: 'ESO9 sets import failed',
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
