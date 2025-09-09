/**
 * Mobile-Optimized Speculative Decoding Example for llama-cpp-capacitor
 * 
 * This example demonstrates how to use speculative decoding to achieve 2-8x faster
 * inference with significantly reduced battery consumption on mobile devices.
 */

import { initLlama, LlamaContext } from 'llama-cpp-capacitor';

// Example 1: Basic Speculative Decoding Setup
async function basicSpeculativeDecoding() {
  console.log('🚀 Setting up speculative decoding...');
  
  // Initialize with speculative decoding
  const context = await initLlama({
    model: '/path/to/your/main-model.gguf',        // Main model (e.g., 7B)
    draft_model: '/path/to/your/draft-model.gguf', // Draft model (e.g., 1.5B)
    n_ctx: 2048,
    n_threads: 4,
    
    // Speculative decoding parameters
    speculative_samples: 3,     // Number of tokens to predict speculatively
    mobile_speculative: true,   // Enable mobile optimizations
  });

  console.log('✅ Context initialized with speculative decoding');

  // Run completion
  const result = await context.completion({
    prompt: "Write a short story about a robot learning to paint:",
    n_predict: 200,
    temperature: 0.7,
  });

  console.log('Generated text:', result.text);
  console.log('Performance stats:', {
    tokens: result.timings?.predicted_n,
    speed: result.timings?.predicted_per_token_ms,
    totalTime: result.timings?.predicted_ms,
  });

  await context.release();
}

// Example 2: Mobile-Optimized Configuration
async function mobileOptimizedSetup() {
  console.log('📱 Setting up mobile-optimized speculative decoding...');
  
  const context = await initLlama({
    model: '/path/to/main-model-q4_0.gguf',         // Quantized main model
    draft_model: '/path/to/draft-model-q4_0.gguf', // Quantized draft model
    n_ctx: 1024,         // Smaller context for mobile
    n_threads: 2,        // Conservative threading
    n_gpu_layers: 32,    // Utilize mobile GPU
    
    // Mobile-specific optimizations
    speculative_samples: 2,     // Conservative speculation for mobile
    mobile_speculative: true,   // Enables mobile-specific optimizations
    
    // Memory optimizations
    n_batch: 64,         // Smaller batch size
    use_mmap: true,      // Memory mapping for efficiency
    use_mlock: false,    // Don't lock memory on mobile
  });

  return context;
}

// Example 3: Performance Comparison
async function performanceComparison() {
  console.log('⚖️ Comparing regular vs speculative decoding performance...');
  
  const testPrompt = "Explain quantum computing in simple terms:";
  const testLength = 100;
  
  // Regular decoding
  console.log('Testing regular decoding...');
  const regularContext = await initLlama({
    model: '/path/to/main-model.gguf',
    n_ctx: 2048,
    n_threads: 4,
    // No draft model = regular decoding
  });
  
  const startRegular = Date.now();
  const regularResult = await regularContext.completion({
    prompt: testPrompt,
    n_predict: testLength,
    temperature: 0.7,
  });
  const regularTime = Date.now() - startRegular;
  
  // Speculative decoding
  console.log('Testing speculative decoding...');
  const speculativeContext = await initLlama({
    model: '/path/to/main-model.gguf',
    draft_model: '/path/to/draft-model.gguf',
    n_ctx: 2048,
    n_threads: 4,
    speculative_samples: 3,
    mobile_speculative: true,
  });
  
  const startSpeculative = Date.now();
  const speculativeResult = await speculativeContext.completion({
    prompt: testPrompt,
    n_predict: testLength,
    temperature: 0.7,
  });
  const speculativeTime = Date.now() - startSpeculative;
  
  // Results
  const speedup = regularTime / speculativeTime;
  console.log(`📊 Performance Results:
    Regular Decoding: ${regularTime}ms
    Speculative Decoding: ${speculativeTime}ms
    Speedup: ${speedup.toFixed(2)}x faster
    Battery Savings: ~${((speedup - 1) / speedup * 100).toFixed(1)}%`);
  
  await regularContext.release();
  await speculativeContext.release();
}

// Example 4: Adaptive Speculative Parameters
async function adaptiveSpeculativeDecoding() {
  console.log('🧠 Setting up adaptive speculative decoding...');
  
  // Start with conservative settings
  let speculativeSamples = 2;
  let context = await initLlama({
    model: '/path/to/main-model.gguf',
    draft_model: '/path/to/draft-model.gguf',
    n_ctx: 2048,
    speculative_samples: speculativeSamples,
    mobile_speculative: true,
  });

  // Function to adapt parameters based on acceptance rate
  const adaptParameters = (acceptanceRate: number) => {
    if (acceptanceRate > 0.8) {
      // High acceptance rate - increase speculation
      speculativeSamples = Math.min(5, speculativeSamples + 1);
    } else if (acceptanceRate < 0.5) {
      // Low acceptance rate - decrease speculation
      speculativeSamples = Math.max(1, speculativeSamples - 1);
    }
    console.log(`🔧 Adapted speculative samples to: ${speculativeSamples} (acceptance: ${(acceptanceRate * 100).toFixed(1)}%)`);
  };

  // Simulate adaptive generation
  for (let i = 0; i < 5; i++) {
    const result = await context.completion({
      prompt: `Generate idea ${i + 1}:`,
      n_predict: 50,
      temperature: 0.8,
    });
    
    // Mock acceptance rate calculation
    // In real implementation, this would come from the native layer
    const mockAcceptanceRate = 0.6 + Math.random() * 0.3;
    adaptParameters(mockAcceptanceRate);
  }

  await context.release();
}

// Example 5: Best Practices for Mobile
async function mobileSpeculativeBestPractices() {
  console.log('📋 Mobile Speculative Decoding Best Practices');
  
  // Recommended model sizes for mobile speculative decoding
  const recommendations = {
    main_model: {
      size: '3-7B parameters',
      quantization: 'Q4_0 or Q4_1',
      format: 'GGUF',
      example: 'llama-2-7b-chat.q4_0.gguf'
    },
    draft_model: {
      size: '1-1.5B parameters', 
      quantization: 'Q4_0',
      format: 'GGUF',
      example: 'tinyllama-1.1b-chat.q4_0.gguf'
    },
    mobile_settings: {
      speculative_samples: '2-3 tokens',
      n_ctx: '1024-2048',
      n_threads: '2-4 (based on device)',
      n_batch: '64-128',
      n_gpu_layers: '16-32 (if Metal/Vulkan available)'
    }
  };
  
  console.log('📱 Mobile Configuration Recommendations:', JSON.stringify(recommendations, null, 2));
  
  // Example optimal mobile configuration
  const mobileContext = await initLlama({
    // Main model (quantized for mobile)
    model: '/models/llama-2-7b-chat.q4_0.gguf',
    
    // Draft model (small and fast)
    draft_model: '/models/tinyllama-1.1b-chat.q4_0.gguf',
    
    // Conservative mobile settings
    n_ctx: 1024,
    n_threads: 3,
    n_batch: 64,
    n_gpu_layers: 24,
    
    // Speculative decoding optimized for mobile
    speculative_samples: 3,
    mobile_speculative: true,
    
    // Memory optimizations
    use_mmap: true,
    use_mlock: false,
  });
  
  console.log('✅ Mobile-optimized context initialized');
  return mobileContext;
}

// Example 6: Error Handling and Fallback
async function robustSpeculativeDecoding() {
  console.log('🛡️ Setting up robust speculative decoding with fallback...');
  
  try {
    // Try speculative decoding first
    const context = await initLlama({
      model: '/path/to/main-model.gguf',
      draft_model: '/path/to/draft-model.gguf',
      speculative_samples: 3,
      mobile_speculative: true,
    });
    
    console.log('✅ Speculative decoding initialized successfully');
    return context;
    
  } catch (error) {
    console.warn('⚠️ Speculative decoding failed, falling back to regular decoding:', error);
    
    // Fallback to regular decoding
    const fallbackContext = await initLlama({
      model: '/path/to/main-model.gguf',
      // No draft_model = regular decoding
    });
    
    console.log('✅ Fallback to regular decoding successful');
    return fallbackContext;
  }
}

// Main execution
async function main() {
  try {
    console.log('🚀 Starting Speculative Decoding Examples');
    
    // Run examples (uncomment the ones you want to test)
    await basicSpeculativeDecoding();
    // await mobileOptimizedSetup();
    // await performanceComparison();
    // await adaptiveSpeculativeDecoding();
    // await mobileSpeculativeBestPractices();
    // await robustSpeculativeDecoding();
    
    console.log('✅ All examples completed successfully');
  } catch (error) {
    console.error('❌ Error running examples:', error);
  }
}

// Export for use in other files
export {
  basicSpeculativeDecoding,
  mobileOptimizedSetup,
  performanceComparison,
  adaptiveSpeculativeDecoding,
  mobileSpeculativeBestPractices,
  robustSpeculativeDecoding,
};

// Run if this file is executed directly
if (require.main === module) {
  main();
}
