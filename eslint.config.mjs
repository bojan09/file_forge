import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "out/**", "node_modules/**", "public/vendor/**", "public/workers/**", "coverage/**", "playwright-report/**", "test-results/**"] },
];

export default config;
