/**
 * Product Sets Integration for Shoptet
 * 
 * This script fetches and displays gift sets containing the current product
 * on the product detail page.
 * 
 * Dependencies: jQuery (already included in Shoptet)
 * API Endpoint: https://YOUR-CLOUD-RUN-URL/product-sets
 */

(function($) {
  'use strict';
  
  // Configuration
  const CONFIG = {
    apiUrl: 'https://YOUR-CLOUD-RUN-URL/product-sets',
    timeout: 5000, // 5 seconds
    debug: false
  };
  
  /**
   * Log debug messages
   */
  function log(message, data) {
    if (CONFIG.debug) {
      console.log('[Product Sets]', message, data || '');
    }
  }
  
  /**
   * Get product code from dataLayer or DOM
   */
  function getProductCode() {
    // Try to get from dataLayer (Shoptet standard)
    try {
      if (window.dataLayer && dataLayer[0] && dataLayer[0].shoptet) {
        const code = dataLayer[0].shoptet.product.code;
        if (code) {
          log('Product code from dataLayer:', code);
          return code;
        }
      }
    } catch (e) {
      log('Error reading from dataLayer:', e);
    }
    
    // Fallback: Try to read from custom data attribute
    const productDetailEl = document.getElementById('product-detail');
    if (productDetailEl) {
      const code = productDetailEl.getAttribute('data-product-code');
      if (code) {
        log('Product code from data attribute:', code);
        return code;
      }
    }
    
    // Fallback: Try to read from meta tag
    const metaEl = document.querySelector('meta[property="product:retailer_item_id"]');
    if (metaEl) {
      const code = metaEl.getAttribute('content');
      if (code) {
        log('Product code from meta tag:', code);
        return code;
      }
    }
    
    log('Product code not found');
    return null;
  }
  
  /**
   * Build HTML for product sets section
   */
  function buildSetsHtml(sets) {
    let html = '<div class="shp-accordion product-sets-accordion" data-testid="tabSets">';
    html += '<div class="shp-accordion-content">';
    html += '<h2 class="can-toggle">Dárkové balíčky s tímto produktem</h2>';
    html += '<div class="product-sets-list">';
    
    sets.forEach(function(set) {
      const imgUrl = set.imgUrl || '';
      const url = set.url || '#';
      const name = set.name || 'Bez názvu';
      const description = set.description || '';
      
      html += '<div class="product-set-item">';
      html += '  <a href="' + escapeHtml(url) + '" class="product-set-link">';
      
      if (imgUrl) {
        html += '    <div class="product-set-image">';
        html += '      <img src="' + escapeHtml(imgUrl) + '" alt="' + escapeHtml(name) + '" loading="lazy" />';
        html += '    </div>';
      }
      
      html += '    <div class="product-set-text">';
      html += '      <h3 class="product-set-name">' + escapeHtml(name) + '</h3>';
      
      if (description) {
        html += '      <p class="product-set-description">' + escapeHtml(description) + '</p>';
      }
      
      html += '    </div>';
      html += '  </a>';
      html += '</div>';
    });
    
    html += '</div>'; // .product-sets-list
    html += '</div>'; // .shp-accordion-content
    html += '</div>'; // .shp-accordion
    
    return html;
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Insert sets HTML into the page
   */
  function insertSetsHtml(html) {
    // Try desktop layout first
    const tabContent = $('#tab-content');
    if (tabContent.length > 0) {
      log('Inserting after #tab-content (desktop)');
      tabContent.after(html);
      return;
    }
    
    // Try mobile layout
    const accordionContent = $('#accordion-content');
    if (accordionContent.length > 0) {
      log('Appending to #accordion-content (mobile)');
      $(html).appendTo(accordionContent);
      return;
    }
    
    // Fallback: insert after product detail
    const productDetail = $('.p-detail');
    if (productDetail.length > 0) {
      log('Inserting after .p-detail (fallback)');
      productDetail.after(html);
      return;
    }
    
    log('Could not find suitable location to insert sets');
  }
  
  /**
   * Fetch and display product sets
   */
  function loadProductSets(productCode) {
    log('Fetching sets for product:', productCode);
    
    $.ajax({
      url: CONFIG.apiUrl,
      method: 'GET',
      data: { productCode: productCode },
      dataType: 'json',
      timeout: CONFIG.timeout,
      success: function(response) {
        log('API response:', response);
        
        if (response.sets && response.sets.length > 0) {
          log('Found ' + response.sets.length + ' sets');
          const html = buildSetsHtml(response.sets);
          insertSetsHtml(html);
          
          // Trigger event for potential custom handlers
          $(document).trigger('productSetsLoaded', [response.sets]);
        } else {
          log('Product is not in any set');
        }
      },
      error: function(xhr, status, error) {
        if (status === 'timeout') {
          console.error('[Product Sets] Request timeout');
        } else {
          console.error('[Product Sets] Error loading sets:', error);
        }
        
        // Trigger error event
        $(document).trigger('productSetsError', [error]);
      }
    });
  }
  
  /**
   * Initialize on document ready
   */
  $(document).ready(function() {
    log('Initializing Product Sets integration');
    
    // Check if we're on a product detail page
    const isProductPage = $('.p-detail').length > 0 || $('#product-detail').length > 0;
    
    if (!isProductPage) {
      log('Not a product detail page, skipping');
      return;
    }
    
    // Get product code
    const productCode = getProductCode();
    
    if (!productCode) {
      console.warn('[Product Sets] Could not determine product code');
      return;
    }
    
    // Load and display sets
    loadProductSets(productCode);
  });
  
})(jQuery);
