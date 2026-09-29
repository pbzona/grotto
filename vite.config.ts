import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";

/** Binary assets are stored base64-encoded in assets/*.b64 (the repo is pushed as text); decode them into the build. */
function b64Assets(): Plugin {
  const files = () => fs.existsSync("assets") ? fs.readdirSync("assets").filter(f => f.endsWith(".b64")) : [];
  return {
    name: "b64-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const f = files().find(f => req.url === "/" + f.replace(/\.b64$/, ""));
        if (!f) return next();
        res.setHeader("Content-Type", f.includes(".jpg") ? "image/jpeg" : "image/png");
        res.end(Buffer.from(fs.readFileSync("assets/" + f, "utf8"), "base64"));
      });
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: "asset", fileName: f.replace(/\.b64$/, ""), source: Buffer.from(fs.readFileSync("assets/" + f, "utf8"), "base64") });
    },
  };
}

export default defineConfig({ plugins: [b64Assets()], build: { target: "es2022", chunkSizeWarningLimit: 4000 } });
