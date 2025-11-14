const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { BigQuery } = require('@google-cloud/bigquery');

// Initialize BigQuery client
const bigquery = new BigQuery();

// Configuration
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GCP_PROJECT || 'cm-monitoring';
const DATASET_ID = 'product_sets';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.chutmoravy.cz';

// Initialize Express
const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow specific origin
    if (origin === ALLOWED_ORIGIN || origin.endsWith('.chutmoravy.cz')) {
      return callback(null, true);
    }
    
    // For development, allow localhost
    if (process.env.NODE_ENV === 'development' && origin.includes('localhost')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

app.use(cors(corsOptions));

// Rate limiting: 500 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Parse JSON bodies
app.use(express.json());

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /product-sets?productCode=<CODE>
 * Returns list of sets containing the specified product
 */
app.get('/product-sets', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { productCode } = req.query;
    
    // Validate input
    if (!productCode) {
      return res.status(400).json({
        error: 'Missing required parameter: productCode'
      });
    }
    
    // Query BigQuery using the view
    const query = `
      SELECT
        set_code AS code,
        name,
        url,
        img_url AS imgUrl,
        description
      FROM
        \`${PROJECT_ID}.${DATASET_ID}.product_sets_view\`
      WHERE
        product_code = @productCode
      ORDER BY
        name
    `;
    
    const options = {
      query: query,
      params: { productCode: productCode },
      location: 'US',
    };
    
    const [rows] = await bigquery.query(options);
    
    // Set cache headers (1 hour)
    res.set('Cache-Control', 'public, max-age=3600');
    
    // Return results
    res.status(200).json({
      sets: rows,
      count: rows.length,
      productCode: productCode,
      queryTime: Date.now() - startTime
    });
    
  } catch (error) {
    console.error('Error querying product sets:', error);
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      queryTime: Date.now() - startTime
    });
  }
});

/**
 * GET /set-detail?setCode=<CODE>
 * Returns list of products in the specified set (future enhancement)
 */
app.get('/set-detail', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { setCode } = req.query;
    
    // Validate input
    if (!setCode) {
      return res.status(400).json({
        error: 'Missing required parameter: setCode'
      });
    }
    
    // Query set details
    const setQuery = `
      SELECT
        product_code AS code,
        name,
        url,
        img_url AS imgUrl,
        short_description AS description
      FROM
        \`${PROJECT_ID}.${DATASET_ID}.products\`
      WHERE
        product_code = @setCode
      LIMIT 1
    `;
    
    // Query set items
    const itemsQuery = `
      SELECT
        si.item_code AS code,
        si.amount,
        p.name,
        p.url,
        p.img_url AS imgUrl,
        p.short_description AS description,
        p.availability
      FROM
        \`${PROJECT_ID}.${DATASET_ID}.set_items\` si
      JOIN
        \`${PROJECT_ID}.${DATASET_ID}.products\` p
      ON
        si.item_code = p.product_code
      WHERE
        si.set_code = @setCode
      ORDER BY
        p.name
    `;
    
    const setOptions = {
      query: setQuery,
      params: { setCode: setCode },
      location: 'US',
    };
    
    const itemsOptions = {
      query: itemsQuery,
      params: { setCode: setCode },
      location: 'US',
    };
    
    const [[setRows], [itemRows]] = await Promise.all([
      bigquery.query(setOptions),
      bigquery.query(itemsOptions)
    ]);
    
    if (setRows.length === 0) {
      return res.status(404).json({
        error: 'Set not found',
        setCode: setCode
      });
    }
    
    // Set cache headers (1 hour)
    res.set('Cache-Control', 'public, max-age=3600');
    
    // Return results
    res.status(200).json({
      set: setRows[0],
      items: itemRows,
      itemsCount: itemRows.length,
      queryTime: Date.now() - startTime
    });
    
  } catch (error) {
    console.error('Error querying set detail:', error);
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      queryTime: Date.now() - startTime
    });
  }
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`Product Sets API listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`Allowed origin: ${ALLOWED_ORIGIN}`);
});
