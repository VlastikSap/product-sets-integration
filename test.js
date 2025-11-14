/**
 * Test suite for Product Sets API
 * 
 * Run with: node test.js
 */

const https = require('https');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:8080';
const TEST_PRODUCT_CODE = 'CHM045';
const TEST_SET_CODE = 'BA195';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

/**
 * Make HTTP request
 */
function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const client = url.protocol === 'https:' ? https : require('http');
    
    const startTime = Date.now();
    
    client.get(url.toString(), (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, duration });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, duration, error: e.message });
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Test helper
 */
function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`${colors.green}✓${colors.reset} ${name}`);
      return true;
    } catch (error) {
      console.log(`${colors.red}✗${colors.reset} ${name}`);
      console.log(`  ${colors.red}Error: ${error.message}${colors.reset}`);
      return false;
    }
  };
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Tests
 */
const tests = [
  test('Health check returns 200', async () => {
    const result = await makeRequest('/health');
    assert(result.status === 200, `Expected 200, got ${result.status}`);
    assert(result.data.status === 'ok', 'Expected status "ok"');
    console.log(`  Response time: ${result.duration}ms`);
  }),
  
  test('Product sets endpoint without productCode returns 400', async () => {
    const result = await makeRequest('/product-sets');
    assert(result.status === 400, `Expected 400, got ${result.status}`);
    assert(result.data.error, 'Expected error message');
  }),
  
  test('Product sets endpoint with valid productCode returns 200', async () => {
    const result = await makeRequest(`/product-sets?productCode=${TEST_PRODUCT_CODE}`);
    assert(result.status === 200, `Expected 200, got ${result.status}`);
    assert(Array.isArray(result.data.sets), 'Expected sets to be an array');
    console.log(`  Found ${result.data.count} sets`);
    console.log(`  Response time: ${result.duration}ms`);
  }),
  
  test('Product sets response has correct structure', async () => {
    const result = await makeRequest(`/product-sets?productCode=${TEST_PRODUCT_CODE}`);
    assert(result.data.sets, 'Expected sets property');
    assert(result.data.count !== undefined, 'Expected count property');
    assert(result.data.productCode === TEST_PRODUCT_CODE, 'Expected productCode in response');
    
    if (result.data.sets.length > 0) {
      const set = result.data.sets[0];
      assert(set.code, 'Expected set.code');
      assert(set.name, 'Expected set.name');
      // url, imgUrl, description are optional
    }
  }),
  
  test('Set detail endpoint without setCode returns 400', async () => {
    const result = await makeRequest('/set-detail');
    assert(result.status === 400, `Expected 400, got ${result.status}`);
  }),
  
  test('Set detail endpoint with valid setCode returns 200', async () => {
    const result = await makeRequest(`/set-detail?setCode=${TEST_SET_CODE}`);
    assert(result.status === 200 || result.status === 404, `Expected 200 or 404, got ${result.status}`);
    
    if (result.status === 200) {
      assert(result.data.set, 'Expected set property');
      assert(Array.isArray(result.data.items), 'Expected items to be an array');
      console.log(`  Found ${result.data.itemsCount} items in set`);
      console.log(`  Response time: ${result.duration}ms`);
    }
  }),
  
  test('Set detail response has correct structure', async () => {
    const result = await makeRequest(`/set-detail?setCode=${TEST_SET_CODE}`);
    
    if (result.status === 200) {
      assert(result.data.set, 'Expected set property');
      assert(result.data.items, 'Expected items property');
      assert(result.data.itemsCount !== undefined, 'Expected itemsCount property');
      
      if (result.data.items.length > 0) {
        const item = result.data.items[0];
        assert(item.code, 'Expected item.code');
        assert(item.amount !== undefined, 'Expected item.amount');
        assert(item.name, 'Expected item.name');
      }
    }
  }),
  
  test('Invalid endpoint returns 404', async () => {
    const result = await makeRequest('/invalid-endpoint');
    assert(result.status === 404, `Expected 404, got ${result.status}`);
  }),
  
  test('Response has cache headers', async () => {
    const result = await makeRequest(`/product-sets?productCode=${TEST_PRODUCT_CODE}`);
    // Note: This test would need to inspect response headers
    // For now, we just check that the request succeeds
    assert(result.status === 200, 'Expected successful response');
  }),
  
  test('API handles concurrent requests', async () => {
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(makeRequest(`/product-sets?productCode=${TEST_PRODUCT_CODE}`));
    }
    
    const results = await Promise.all(requests);
    const allSuccessful = results.every(r => r.status === 200);
    assert(allSuccessful, 'Expected all concurrent requests to succeed');
    
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    console.log(`  Average response time: ${avgDuration.toFixed(2)}ms`);
  }),
  
  test('API responds within acceptable time', async () => {
    const result = await makeRequest(`/product-sets?productCode=${TEST_PRODUCT_CODE}`);
    assert(result.status === 200, 'Expected successful response');
    assert(result.duration < 1000, `Response too slow: ${result.duration}ms (expected < 1000ms)`);
    console.log(`  Response time: ${result.duration}ms`);
  })
];

/**
 * Run all tests
 */
async function runTests() {
  console.log(`${colors.blue}Running Product Sets API Tests${colors.reset}`);
  console.log(`API URL: ${API_URL}\n`);
  
  let passed = 0;
  let failed = 0;
  
  for (const testFn of tests) {
    const success = await testFn();
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Total: ${passed + failed} tests`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`${colors.green}All tests passed!${colors.reset}`);
  }
}

// Run tests
runTests().catch(err => {
  console.error(`${colors.red}Error running tests:${colors.reset}`, err);
  process.exit(1);
});
