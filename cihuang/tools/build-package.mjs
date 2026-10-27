// 生成打包版离线前端：只保留运行时需要的资源，注入离线开关，去掉外部入口。
// 用法：node cihuang/tools/build-package.mjs
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(root, "packaging", "web");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const name of ["index.html", "assets", "data/topics", "data/game"]) {
  cpSync(join(root, name), join(out, name), { recursive: true });
}

// 内部 QA 元数据（_qa.json 等）不上线、不进安装包
const topicsOut = join(out, "data", "topics");
for (const file of readdirSync(topicsOut)) {
  if (file.startsWith("_")) rmSync(join(topicsOut, file), { force: true });
}

const index = readFileSync(join(out, "index.html"), "utf8");
let html = index.replace(
  '<script type="module" src="assets/game.js',
  '<script>window.__CIHUANG_OFFLINE__ = true;</script>\n<script type="module" src="assets/game.js',
);
html = html.replace('<a href="/">云吞吞文游</a>', "<span>云吞吞工作室</span>");
writeFileSync(join(out, "index.html"), html);

console.log(`packaged web -> ${out}`);
