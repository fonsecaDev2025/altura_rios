const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-undef": "error",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        HTMLElement: "readonly",
        Event: "readonly",
        location: "readonly",
        navigator: "readonly",
        resolveApiUrl: "readonly",
        formatApiHttpError: "readonly",
        UI: "readonly",
      },
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        self: "readonly",
        caches: "readonly",
        clients: "readonly",
        Response: "readonly",
        Request: "readonly",
        URL: "readonly",
        fetch: "readonly",
        console: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/", "data/", "package-lock.json", "test/_tmp_*/"],
  },
];
