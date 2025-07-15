module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
    jest: true,
  },
  extends: [
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "google",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
    ecmaVersion: 2018,
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/node_modules/**/*", // Ignore dependencies.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    // Import rules
    "import/no-unresolved": 0,
    "import/order": [
      "error",
      {
        "groups": [
          "builtin",
          "external",
          "internal",
          "parent",
          "sibling",
          "index"
        ],
        "newlines-between": "always",
        "alphabetize": {
          "order": "asc",
          "caseInsensitive": true
        }
      }
    ],

    // TypeScript rules
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/prefer-const": "error",
    "@typescript-eslint/no-inferrable-types": "error",

    // General rules
    "quotes": ["error", "single"],
    "indent": ["error", 2],
    "max-len": ["error", { "code": 100, "ignoreUrls": true }],
    "object-curly-spacing": ["error", "always"],
    "comma-dangle": ["error", "always-multiline"],
    "semi": ["error", "always"],
    "no-console": "warn",
    "no-debugger": "error",
    "no-unused-vars": "off", // Use TypeScript version instead
    "prefer-const": "error",
    "no-var": "error",
    "eqeqeq": ["error", "always"],
    "curly": ["error", "all"],
    "brace-style": ["error", "1tbs"],

    // Function rules
    "require-jsdoc": "off", // TypeScript provides better documentation
    "valid-jsdoc": "off",
    "new-cap": ["error", { "capIsNew": false }],

    // Spacing rules
    "space-before-function-paren": ["error", {
      "anonymous": "always",
      "named": "never",
      "asyncArrow": "always"
    }],
    "keyword-spacing": ["error", { "before": true, "after": true }],
    "space-infix-ops": "error",
    "space-unary-ops": ["error", { "words": true, "nonwords": false }],

    // Array and object rules
    "array-bracket-spacing": ["error", "never"],
    "computed-property-spacing": ["error", "never"],
    "no-trailing-spaces": "error",
    "eol-last": ["error", "always"],

    // Error handling
    "no-throw-literal": "error",
    "prefer-promise-reject-errors": "error",

    // Performance
    "no-await-in-loop": "warn",
    "no-return-await": "error",

    // Security
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.spec.ts"],
      env: {
        jest: true,
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "no-console": "off",
        "max-len": ["error", { "code": 120 }],
      },
    },
  ],
};

