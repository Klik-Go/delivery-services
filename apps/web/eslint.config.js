import { createConfig } from "@klikgo/config/eslint";

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  next: true,
  react: true,
  layer: "web",
});
