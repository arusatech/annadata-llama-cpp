/**
 * Grammar and Tool Calling Examples for llama-cpp-capacitor
 */

import { initLlama, convertJsonSchemaToGrammar, LlamaContext } from 'llama-cpp-capacitor';

// Example 1: Using GBNF Grammar directly
async function grammarExample() {
  const context = await initLlama({
    model: '/path/to/model.gguf',
    n_ctx: 2048,
    n_threads: 4
  });

  // GBNF grammar for generating JSON objects with name and age
  const gbnfGrammar = `
root ::= "{" ws name_field "," ws age_field "}"
name_field ::= "\\"name\\"" ws ":" ws string_value
age_field ::= "\\"age\\"" ws ":" ws number_value
string_value ::= "\\"" [a-zA-Z ]+ "\\""
number_value ::= [0-9]+
ws ::= [ \\t\\n]*
`;

  const result = await context.completion({
    prompt: "Generate a person's profile:",
    grammar: gbnfGrammar,
    n_predict: 100,
    temperature: 0.8
  });

  console.log('Generated with GBNF grammar:', result.text);
  await context.release();
}

// Example 2: Using JSON Schema converted to GBNF
async function jsonSchemaExample() {
  const context = await initLlama({
    model: '/path/to/model.gguf',
    n_ctx: 2048,
    n_threads: 4
  });

  // Define JSON schema
  const personSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number', minimum: 0, maximum: 150 },
      email: { type: 'string', format: 'email' },
      skills: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5
      }
    },
    required: ['name', 'age'],
    additionalProperties: false
  };

  // Method 1: Use response_format (automatic conversion)
  const result1 = await context.completion({
    prompt: "Generate a developer profile:",
    n_predict: 200,
    temperature: 0.7,
    response_format: {
      type: 'json_schema',
      json_schema: {
        strict: true,
        schema: personSchema
      }
    }
  });

  console.log('Generated with JSON schema (auto-converted):', result1.content);

  // Method 2: Manual conversion to GBNF
  const grammar = await convertJsonSchemaToGrammar(personSchema);
  console.log('Converted GBNF grammar:', grammar);

  const result2 = await context.completion({
    prompt: "Generate another developer profile:",
    grammar: grammar,
    n_predict: 200,
    temperature: 0.7
  });

  console.log('Generated with manually converted grammar:', result2.text);
  await context.release();
}

// Example 3: Tool Calling with Grammar
async function toolCallingExample() {
  const context = await initLlama({
    model: '/path/to/model.gguf',
    n_ctx: 2048,
    n_threads: 4
  });

  const tools = [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City and state, e.g. San Francisco, CA'
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: 'Temperature unit'
            }
          },
          required: ['location']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the web for information',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            },
            max_results: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              description: 'Maximum number of results'
            }
          },
          required: ['query']
        }
      }
    }
  ];

  const result = await context.completion({
    messages: [
      { role: 'system', content: 'You are a helpful assistant with access to tools.' },
      { role: 'user', content: 'What\'s the weather like in New York and search for recent AI news?' }
    ],
    tools: tools,
    tool_choice: 'auto',
    n_predict: 300,
    temperature: 0.7
  });

  console.log('Response content:', result.content);
  console.log('Tool calls:', result.tool_calls);

  // Handle tool calls
  if (result.tool_calls && result.tool_calls.length > 0) {
    for (const toolCall of result.tool_calls) {
      console.log(`Tool: ${toolCall.function.name}`);
      console.log(`Arguments: ${toolCall.function.arguments}`);
      
      // Parse arguments
      const args = JSON.parse(toolCall.function.arguments);
      
      // Simulate tool execution
      let toolResult;
      switch (toolCall.function.name) {
        case 'get_weather':
          toolResult = `Weather in ${args.location}: 72°F, sunny`;
          break;
        case 'search_web':
          toolResult = `Search results for "${args.query}": Found ${args.max_results || 5} relevant articles about AI advances.`;
          break;
        default:
          toolResult = 'Tool not implemented';
      }
      
      console.log(`Tool result: ${toolResult}`);
    }
  }

  await context.release();
}

// Example 4: Complex Grammar for Code Generation
async function codeGenerationExample() {
  const context = await initLlama({
    model: '/path/to/code-model.gguf',
    n_ctx: 2048,
    n_threads: 4
  });

  // GBNF grammar for TypeScript function generation
  const typescriptFunctionGrammar = `
root ::= function_declaration
function_declaration ::= "function" ws identifier "(" ws parameter_list? ws ")" ws return_type? ws "{" ws function_body ws "}"
identifier ::= [a-zA-Z_][a-zA-Z0-9_]*
parameter_list ::= parameter ("," ws parameter)*
parameter ::= identifier ws ":" ws type_annotation
return_type ::= ":" ws type_annotation
type_annotation ::= "string" | "number" | "boolean" | "void"
function_body ::= statement*
statement ::= return_statement | expression_statement
return_statement ::= "return" ws expression ";"
expression_statement ::= expression ";"
expression ::= string_literal | number_literal | identifier
string_literal ::= "\\"" [^"]* "\\""
number_literal ::= [0-9]+
ws ::= [ \\t\\n]*
`;

  const result = await context.completion({
    prompt: "Generate a TypeScript function that calculates the area of a rectangle:",
    grammar: typescriptFunctionGrammar,
    n_predict: 150,
    temperature: 0.3
  });

  console.log('Generated TypeScript function:', result.text);
  await context.release();
}

// Run examples
async function runExamples() {
  console.log('=== Grammar and Tool Calling Examples ===\n');
  
  try {
    console.log('1. GBNF Grammar Example:');
    await grammarExample();
    console.log('\n');
    
    console.log('2. JSON Schema Example:');
    await jsonSchemaExample();
    console.log('\n');
    
    console.log('3. Tool Calling Example:');
    await toolCallingExample();
    console.log('\n');
    
    console.log('4. Code Generation Example:');
    await codeGenerationExample();
    console.log('\n');
    
    console.log('✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

// Export for use
export {
  grammarExample,
  jsonSchemaExample,
  toolCallingExample,
  codeGenerationExample,
  runExamples
};

// Run if called directly
if (require.main === module) {
  runExamples();
}
