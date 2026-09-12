// 角色立绘批量生成:遍历 docs/english-cards/{r1,m5}-*.card.json 的 structured.npcs
// prompt = 人名 + 中文画风词 + NPC 中文外貌标签(总长≤320 字符,超长按逗号边界截断) → /api/cover/generate ratio 3:4(pregen 通道)
// 反向提示词随 body.negative 透传(worker 侧转给 Agnes/Kolors,并进缓存键)——当前 NEG_ZH 为空,即不传
// 画风:韩系乙女手游柔光风(小徐 2026-09-11 横评 4 组画风后选定 C,明确"不要任何厚涂");外貌标签见 APPEAR_ZH
// 产物: scenarios/covers/loveart_{slug}_{npc}.png(全小写下划线);并回填卡 JSON structured.npcs[i].art(https://bitlife.blupure.cn/scenarios/covers/xxx.png)
// 用法: node scripts/gen_love_art.mjs <pregenKey> <pbAdminEmail> <pbAdminPassword> [--slug r1-01] [--npc Ethan] [--dry]
//        [--provider siliconflow] [--outdir <dir>] [--no-refill] [--force]
import fs from "node:fs";
import path from "node:path";

const FLAG_KEYS = ["slug", "npc", "provider", "outdir"];
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
).filter(([k]) => FLAG_KEYS.includes(k)));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2)));
const [pregenKey, pbAdminEmail, pbAdminPassword] = process.argv.slice(2).filter((x) => !x.startsWith("--") && !FLAG_KEYS.some((k) => args[k] === x));
if (!pregenKey || !pbAdminEmail || !pbAdminPassword) {
    console.error("用法: node gen_love_art.mjs <pregenKey> <pbAdminEmail> <pbAdminPassword> [--slug r1-01] [--npc Ethan] [--dry] [--provider siliconflow] [--outdir dir] [--no-refill] [--force]");
    process.exit(1);
}
const PB_URL = process.env.PB_URL || "https://db.blupure.cn";
const API = process.env.COVER_API || "https://ai.blupure.cn/api/cover/generate";
const CARDS_DIR = "docs/english-cards";
const OUT_DIR = args.outdir || "scenarios/covers";
const STATIC_BASE = "https://bitlife.blupure.cn/scenarios/covers/";
const MAX_PROMPT = 320;
// 画风(小徐 2026-09-12 第二次调整):日系二次元 3D 虚拟人 CG,重点=高 key 柔光 + 纯白背景 + 皮肤无毛孔 + 头发成束
// 画风演变：2D 厚涂 → 恋与深空 3D CG(否) → 厚涂原画(否) → 韩系柔光(2026-09-11 上线) → 3D 超写实(A/B/C 试产判"偏写实人像") → **本版:二次元 3D 虚拟人+高 key 纯白(试产中)**
// 旧词存档——韩系柔光：韩系乙女手游插画风格角色立绘，柔和渐变上色，细腻水润的笔触过渡，精致美型五官，柔光打底，通透微微发光的皮肤，发丝柔顺有光泽，唯美柔和氛围，现代都市服装，半身立绘，简约虚化背景，高细节，画面干净通透，高级感
// 小徐参照英文原词(存档)："masterpiece, best quality, 1boy, young handsome male, CG virtual human, 3D render, pale smooth porcelain skin, no pores, big dark eyes, delicate eyeliner, neat hair bundles, clean hair edge, soft diffused studio lighting, bright pure white background, soft shadow, high key lighting, clean rendering, subsurface scattering, anime aesthetic, love and deepspace style, portrait, bust shot, sharp focus"
// 注:英文词中的 ash gray hair / white sports jacket / tracksuit 等是参照图角色外观,不采用——发型服装仍由 APPEAR_ZH 逐角色指定
// 小徐 2026-09-12 定:韩系柔光打底(线上版效果好,不换)+ 融入 F 版的 CG 质感项(通透陶瓷肌/大长圆眼冷感/发束整齐/高 key 柔光)
const STYLE_ZH = "韩系乙女手游插画风格角色立绘，柔和渐变上色，细腻水润的笔触过渡，精致美型五官，白皙通透的陶瓷肌肤质感，柔和流畅的脸型，偏大长圆眼眼尾修长，冷感平淡眼神，柔光打底，高 key 柔光正面打光，整体明亮柔和，发型成束，发缘整齐利落，光泽均匀，唯美柔和氛围，现代都市服装，简约虚化背景，高细节，画面干净通透，次表面散射，高级感";
// 负面词历史:2026-09-11 删光;2026-09-12 一度重新启用(反写实组)后发现负面词反而拉偏画风,当日再次清空,不再启用
// 注意:ARCHIVED 中"反 3D 人偶"组(3D渲染/人偶/塑料皮肤…)与当前"3D 虚拟人"方向互斥,现方向下不可启用
// 历史漂移存档(若复现从 ARCHIVED_NEG_ZH 取回):
//   反脏色块：脏脸，暗沉浑浊阴影，糊脸，画面脏污噪点，厚重脏色块，油腻，噪点
//   反古风漂移：古装，古风服饰，发簪头饰，盔甲
//   反越界瞳色：琥珀色瞳孔，金色瞳孔，浅褐色瞳孔，紫色瞳孔，红色瞳孔，异色瞳
//   反男性漂移：胡子，胡渣，络腮胡，女性化，兽耳，猫耳，狼耳，动物耳朵
//   反多余配饰：眼镜，纹身，耳钉，耳环，唇钉，鼻环
const ARCHIVED_NEG_ZH = "3D渲染，人偶，娃娃，塑料皮肤，光滑CG质感，捏脸模型，网红统一五官，同质化面部，塑料毛发，强高光糊脸，畸形五官，脏阴影，噪点，油腻，卡通Q版，blender渲染，虚幻引擎，黏土质感，脏脸，暗沉浑浊阴影，糊脸，画面脏污噪点，厚重脏色块，古装，古风服饰，发簪头饰，盔甲，琥珀色瞳孔，金色瞳孔，浅褐色瞳孔，紫色瞳孔，红色瞳孔，异色瞳，胡子，胡渣，络腮胡，女性化，兽耳，猫耳，狼耳，动物耳朵，眼镜，纹身，耳钉，耳环，唇钉，鼻环";
// 负面词一律不传(小徐 2026-09-12 定):负面词里的画风词/骨骼词/人种词/杂色阴影词会被 Kolors 当内容理解(语义泄漏),
// 越写"不要写实"越把画面往写实真人拉——本模型下负面词=反效果。画风全靠正向 STYLE_ZH 拉。
const NEG_ZH = "";
// 性别锚点(2026-09-11 打样实测:无锚点时男角色被画成女性——Owen 明显女性化;并加"现代"防 Kolors 中文提示词漂向古风——Noah 出武侠感)
// 长发型(狼尾/半束辫)会让 Kolors 把男性画成中性脸,补骨骼锚把下颌线拉回来(2026-09-11 二次打样实测)
const ANCHOR_M = "男性青年，柔和流畅的面部轮廓，柔和下颌线，";
const ANCHOR_F = "女性青年，";
// 构图(2026-09-12):韩系柔光版的取景小徐认可,恢复原写法并在句尾(与线上现行版一致);九轮实测确认"取景词写法/位置"都压不住取景,脸词体量才是杠杆
const FRAME_ZH = "，半身立绘取景，构图完整";
// NPC 中文外貌标签:由卡 JSON 的英文 appearance 提炼,固定"人种 → 发型 → 瞳色 → 身形 → 服装 → 气质"顺序
// ①人种逐角色指定(小徐 2026-09-11 定):多数东亚面孔,少数欧亚混血拉开五官差异;写进标签而非公共画风词
// ②用"瞳色"而非"眼睛"是实测教训:写"深色短发,明亮蓝色眼睛"时模型把"蓝色"串到头发上(Marcus 出了亮蓝发)
// ③瞳孔只允许黑/蓝/绿三色(小徐 2026-09-11 定):琥珀、浅榛、祖母绿等一律改掉,越界色进 NEG_ZH
// ④发型只允许取自"热门恋爱游戏角色发型库·现代都市风"章节(小徐 2026-09-11 定),库中古风款一律不用:
//    男——陆景和款(深棕纹理碎盖)/萧逸款(黑短碎盖)/齐司礼款(长直发低扎半束辫)/沈星回款(中长片状狼尾→写"层次碎发")
//        /祁煜款(最长狼尾→写"及肩长层次碎发")/莫弈款(偏分微卷短发)/夏以昼款(短款多层狼尾→"短款多层碎发")/查理苏款(偏分短发)
//        /秦彻款(短碎型狼尾→"短碎型层次碎发")/陆沉款(三七分短发)/祁煜日常款(短款微卷)/黎深款(中长型片状狼尾→"片状层次碎发")/左然款(工整二八分)
//    女——齐肩锁骨短发/抓发低盘发/侧麻花辫/高扎马尾(库中现代女款仅此4类,多人复用靠发色+气质区分)
// ⑥"狼尾"三个字必须改写成"层次碎发"(2026-09-11 实测):直接写"狼尾"会让 Kolors 给角色加兽耳
const APPEAR_ZH = {
    "r1-01-film-club|Ethan": "东亚面孔，深棕纹理碎盖，发顶蓬松有层次，刘海偏分自然服帖，瞳色黑色，高挑清瘦，穿复古牛仔外套，温和书卷气质",
    "r1-01-film-club|Liam": "东亚面孔，黑色短碎盖，厚刘海带自然弧度，发顶蓬松有纹理感，鬓角短而利落，瞳色蓝色，健硕高个，穿篮球球衣，阳光少年气质",
    "r1-01-film-club|Noah": "东亚面孔，黑色长直发，脑后低扎细小半束发辫，额前碎发修饰脸型，长发柔顺垂落肩背，瞳色黑色，清瘦高挑，穿针织开衫内搭白衬衫，知性优雅气质",
    "r1-01-film-club|Marcus": "欧亚混血面孔，五官立体，深棕近黑中长片状层次碎发，发尾与两侧收得干净利落，线条流畅顺滑，瞳色蓝色，轮廓分明高挑清瘦，穿修身西服，冷峻神秘气质",
    "r1-01-film-club|Owen": "东亚面孔，浅亚麻棕及肩长层次碎发，发尾自然微卷外翘，慵懒贵气，瞳色绿色，高挑清瘦，穿帆布夹克，宁静艺术气质",
    "r1-02-aurora-cafe|Julian": "东亚面孔，深棕偏分微卷短发，发卷柔和自然，刘海侧分露出额头，瞳色黑色，高大挺拔，穿针织开衫内搭白衬衫，儒雅学者气质",
    "r1-02-aurora-cafe|Alex": "东亚面孔，深棕短款多层碎发，两侧发尾自然上翘，层次丰富蓬松，瞳色蓝色，高挑健硕，穿运动健身装，阳光运动气质",
    "r1-02-aurora-cafe|Daniel": "东亚面孔，浅棕偏分短发，发量浓密有光泽，刘海自然偏分不遮眼，简洁干练，瞳色绿色，高挑清瘦，穿白色医生大褂，温文尔雅气质",
    "r1-02-aurora-cafe|Leo": "欧亚混血面孔，五官立体，红棕短碎型层次碎发，两侧带自然微卷，发尾凌乱随性，瞳色绿色，高挑清瘦，穿复古乐队T恤，自由不羁气质",
    "r1-02-aurora-cafe|Kevin": "东亚面孔，深棕三七分短发，刘海梳理服帖，发顶蓬松不贴头皮，鬓角修剪整齐，瞳色蓝色，高挑清瘦，穿合身西服，精致精英气质",
    "r1-03-photo-club|Lily": "东亚面孔，棕色凌乱感抓发盘发，颅顶蓬松显发量，干练高级，瞳色蓝色，高挑挺拔，穿简约衬衫，干练自信气质",
    "r1-03-photo-club|Mia": "东亚面孔，深棕单侧三股麻花辫，编发后刻意扯松营造蓬松感，鬓角碎发自然卷翘，瞳色绿色，高挑纤细，穿飘逸衬衫连衣裙，清冷艺术气质",
    "r1-03-photo-club|Ava": "东亚面孔，红棕清爽高扎马尾，发尾自然垂落，偏分刘海，瞳色绿色，高挑健硕，穿运动休闲装，阳光活力气质",
    "r1-03-photo-club|Sofia": "欧亚混血面孔，五官立体，浅棕齐肩锁骨短发，发尾微卷蓬松，侧分刘海露出额头，瞳色蓝色，高挑纤细，穿休闲连衣裙，温柔亲和气质",
    "r1-03-photo-club|Grace": "东亚面孔，黑色齐肩锁骨短发，发尾自然内扣弧度，空气薄刘海，瞳色蓝色，高挑修长，穿白色衬衫配牛仔裤，知性优雅气质",
    "m5-01-first-semester|Ethan": "东亚面孔，黑色长直发，脑后低扎细小半束发辫，额前碎发修饰脸型，长发柔顺垂落肩背，瞳色黑色，高挑清瘦，穿休闲衬衫，锐利艺术感五官",
    "m5-01-first-semester|Caleb": "东亚面孔，浅棕短款微卷发，刘海蓬松凌乱带空气感，发尾自然内扣，瞳色蓝色，高挑清瘦，穿时尚夹克，爽朗迷人笑容",
    "m5-01-first-semester|Ryan": "东亚面孔，深棕中长型片状层次碎发，发顶蓬松利落，两侧碎发收得干净整齐，发尾平直硬朗，瞳色蓝色，高挑健硕，穿厚毛衣，粗犷可靠气质",
    "m5-01-first-semester|Theo": "欧亚混血面孔，五官立体，深棕近黑工整二八分短发，线条利落，发丝服帖有光泽，瞳色蓝色，高挑清瘦，穿挺括衬衫，冷静神秘气质",
    "m5-01-first-semester|Nathan": "东亚面孔，棕色及肩长层次碎发，发尾自然微卷外翘，慵懒贵气，瞳色绿色，清瘦高挑，穿印花T恤，艺术神秘气质",
    "m5-02-weekend-win|Ava": "东亚面孔，黑色凌乱感抓发盘发，颅顶蓬松显发量，冷艳高级，瞳色绿色，高挑，穿素色职业套装，职业干练气质",
    "m5-02-weekend-win|Rosa": "东亚面孔，黑色齐肩锁骨短发，发尾自然内扣，侧分刘海，瞳色绿色，高挑，穿黑色职业西装，强势统领气场",
    "m5-02-weekend-win|Chloe": "东亚面孔，深棕清爽高扎马尾，发尾自然垂落，偏分刘海，瞳色黑色，运动型健康身形，穿运动装，活力气质",
    "m5-02-weekend-win|Iris": "欧亚混血面孔，五官立体，棕色齐肩锁骨短发，发尾微卷蓬松，侧分刘海露出额头，瞳色绿色，高挑纤细，穿职业西装外套，知性自由气质",
    "m5-02-weekend-win|Selina": "东亚面孔，深棕凌乱感抓发盘发，颅顶蓬松显发量，瞳色黑色，清瘦，穿修身西装外套配牛仔裤，干练时尚气质",
    // P3 五卡回炉(2026-09-12 追加):01/02/05 男向(攻略对象为女性),03/04 女向(攻略对象为男性)
    "p3-01-last-desk|Maya": "东亚面孔，深棕齐肩锁骨短发，发尾自然内扣，空气薄刘海，瞳色黑色，清瘦沉静，穿米色针织开衫，温柔安静气质",
    "p3-01-last-desk|Ivy": "东亚面孔，黑色抓发低盘发，颅顶蓬松显发量，鬓角碎发利落，瞳色蓝色，清瘦挺拔，穿深灰高领毛衣，清冷理性气质",
    "p3-01-last-desk|Cora": "东亚面孔，黑色清爽高扎马尾，偏分刘海，发尾自然垂落，瞳色黑色，娇小轻盈，穿棕色围裙内搭白T恤，元气明亮气质",
    "p3-01-last-desk|Selene": "东亚面孔，黑色单侧三股麻花辫，编发刻意扯松蓬松，瞳色绿色，清瘦修长，穿深色宽松毛衣配格纹围巾，文艺神秘气质",
    "p3-01-last-desk|June": "东亚面孔，浅亚麻棕高扎马尾，发尾波浪卷，瞳色黑色，健康匀称，穿修身棒球夹克，反差活力气质",
    "p3-02-landing-intern|Ava": "东亚面孔，深棕抓发低盘发，颅顶蓬松，瞳色黑色，高挑苗条，穿浅灰职业套装，专业亲和气质",
    "p3-02-landing-intern|Rosa": "东亚面孔，黑色齐肩锁骨短发，侧分刘海，发尾利落内扣，瞳色绿色，高挑挺拔，穿黑色修身西装，强势干练气质",
    "p3-02-landing-intern|Nadia": "东亚面孔，黑色高扎马尾，发尾直顺，瞳色黑色，高挑清瘦，穿简约衬衫配西裤，锋利自信气质",
    "p3-02-landing-intern|Zoe": "欧亚混血面孔，五官立体，深棕侧麻花辫，发尾微卷蓬松，瞳色蓝色，高挑纤细，穿棕色围裙内搭米色毛衣，温暖慵懒气质",
    "p3-02-landing-intern|Vivian": "东亚面孔，浅棕抓发低盘发，鬓角碎发柔和，瞳色黑色，高挑修长，穿深色高领针织配阔腿裤，从容优雅气质",
    "p3-03-group-presentation|Jake": "东亚面孔，黑色短碎盖，厚刘海带自然弧度，瞳色黑色，高挑清瘦，穿黑色连帽卫衣，沉默专注气质",
    "p3-03-group-presentation|Noah": "东亚面孔，深棕纹理碎盖，发顶蓬松有层次，瞳色蓝色，高挑，穿休闲衬衫，爽朗健谈气质",
    "p3-03-group-presentation|Felix": "欧亚混血面孔，五官立体，深棕偏分微卷短发，发卷柔和自然，瞳色绿色，高挑清瘦，穿工装外套，专注严谨气质",
    "p3-03-group-presentation|Ian": "东亚面孔，黑色工整二八分短发，线条利落，瞳色黑色，高大挺拔，穿休闲西装外套，从容自信气质",
    "p3-03-group-presentation|Cole": "东亚面孔，黑色短款多层碎发，发尾凌乱随性，瞳色黑色，健硕高个，穿运动卫衣，率真开朗气质",
    "p3-04-flatmates|Ben": "东亚面孔，黑色短碎盖，刘海自然服帖，瞳色黑色，健硕，穿运动T恤，老实耿直气质",
    "p3-04-flatmates|Ahmed": "欧亚混血面孔，五官立体，黑色偏分微卷短发，瞳色黑色，中等健硕，穿针织衫配围裙，温和体贴气质",
    "p3-04-flatmates|Devon": "东亚面孔，黑色片状层次碎发，发尾凌乱垂落，瞳色黑色，高挑清瘦，穿复古乐队T恤，颓废随性气质",
    "p3-04-flatmates|Marco": "欧亚混血面孔，五官立体，深棕三七分短发，刘海梳理服帖，瞳色绿色，高挑，穿白色衬衫配餐厅围裙，温暖爽朗气质",
    "p3-04-flatmates|Simon": "东亚面孔，深棕短款微卷发，刘海蓬松自然，瞳色黑色，结实匀称，穿工装背带裤，安静可靠气质",
    "p3-05-debate-club|Tessa": "东亚面孔，黑色高扎马尾，发尾直顺利落，瞳色黑色，高挑清瘦，穿校队西装外套，锋利自信气质",
    "p3-05-debate-club|Yuki": "东亚面孔，黑色齐肩锁骨短发，发尾自然内扣，瞳色黑色，清瘦，穿针织开衫配衬衫，安静细致气质",
    "p3-05-debate-club|Quinn": "东亚面孔，深棕抓发低盘发，颅顶蓬松显发量，瞳色蓝色，高挑，穿制服外套配百褶裙，强势认真气质",
    "p3-05-debate-club|Blaire": "欧亚混血面孔，五官立体，浅棕侧麻花辫，编发刻意扯松蓬松，瞳色绿色，高挑，穿深色校服西装，傲慢犀利气质",
    "p3-05-debate-club|Hana": "东亚面孔，浅棕高扎马尾，额前空气刘海，瞳色黑色，清瘦，穿校报马甲内搭衬衫，灵动细腻气质",
};

const isMaleNpc = (npc) => String((npc && npc.gender) || "").trim() === "男";
function slugify(s) { return String(s || "npc").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function enHead(s, n) {
    const words = String(s || "").split(/\s+/).filter(Boolean);
    let out = "";
    for (const w of words) { if ((out + " " + w).trim().length > n) break; out = (out ? out + " " : "") + w; }
    return out.trim();
}
// 中文按逗号边界截断:中文无空格,硬切会把外貌词切一半
function zhHead(s, n) {
    const raw = String(s || "").replace(/\s+/g, " ").trim();
    if (raw.length <= n) return raw;
    const cut = raw.slice(0, n);
    const i = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf(","));
    return (i > 0 ? cut.slice(0, i) : cut).trim();
}

async function pbJson(url, opts) {
    const res = await fetch(url, opts);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`PB ${res.status}: ${JSON.stringify(d).slice(0, 200)}`);
    return d;
}
async function getToken() {
    const admin = await pbJson(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: pbAdminEmail, password: pbAdminPassword })
    });
    const USER_EMAIL = "cover_pregen@test.local";
    const USER_PASS = "cover_pregen_2026!";
    const authH = { "Content-Type": "application/json", "Authorization": `Bearer ${admin.token}` };
    try {
        await pbJson(`${PB_URL}/api/collections/users/records`, {
            method: "POST", headers: authH,
            body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS, passwordConfirm: USER_PASS, name: "封面预生成", verified: true })
        });
        console.log("已创建预生成账号", USER_EMAIL);
    } catch (e) {
        if (!/validation_not_unique/.test(String(e.message))) throw e;
    }
    const user = await pbJson(`${PB_URL}/api/collections/users/auth-with-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: USER_EMAIL, password: USER_PASS })
    });
    return user.token;
}

const onlySlug = args.slug ? String(args.slug) : "";
const onlyNpc = args.npc ? String(args.npc).toLowerCase() : "";
const cardFiles = fs.readdirSync(CARDS_DIR).filter((f) => /^(r1|m5|p3)-.*\.card\.json$/.test(f) && (!onlySlug || f.startsWith(onlySlug))).sort();
if (!cardFiles.length) { console.error("无匹配卡:", onlySlug || "r1-*/m5-*/p3-*"); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const token = await getToken();
let ok = 0, failed = 0, skipped = 0;
const perCard = [];
for (const cf of cardFiles) {
    const card = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, cf), "utf8"));
    const slug = cf.replace(/\.card\.json$/, "");
    const npcs = (card.structured && Array.isArray(card.structured.npcs)) ? card.structured.npcs : [];
    const filled = [];
    for (const npc of npcs) {
        if (!npc || !npc.name) continue;
        if (onlyNpc && String(npc.name).toLowerCase() !== onlyNpc) continue;
        const nm = slugify(npc.name);
        const rel = `loveart_${slug}_${nm}.png`;
        const file = path.join(OUT_DIR, rel);
        if (!flags.has("force") && !flags.has("dry") && fs.existsSync(file) && fs.statSync(file).size > 1000) {
            console.log(`SKIP ${rel} 已存在`);
            filled.push({ name: npc.name, art: STATIC_BASE + rel });
            skipped++;
            continue;
        }
        // 人名声 + 性别锚:保证同批 prompt 两两不同(旧版截断后多个角色 prompt 撞车出同图)
        const prefix = String(npc.name).trim() + "，" + (isMaleNpc(npc) ? ANCHOR_M : ANCHOR_F);
        const tag = APPEAR_ZH[`${slug}|${npc.name}`] || enHead(String(npc.appearance || npc.personality || ""), 90);
        if (!tag) { console.log(`SKIP ${npc.name} 无外貌描述`); filled.push({ name: npc.name, art: "" }); skipped++; continue; }
        const fixed = prefix.length + STYLE_ZH.length + FRAME_ZH.length;
        const body = zhHead(tag, MAX_PROMPT - fixed);
        const prompt = (prefix + body + "，" + STYLE_ZH + FRAME_ZH).slice(0, MAX_PROMPT);
        if (flags.has("dry")) { console.log(`DRY ${npc.name} (${prompt.length}): ${prompt}`); skipped++; continue; }
        const start = Date.now();
        // SiliconFlow 偶发 502/超时(实测约 1/10),失败退避重试;3 次仍失败才计入 failed
        let lastErr = "";
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt) await new Promise((res) => setTimeout(res, attempt * 5000));
            try {
                const res = await fetch(API, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Auth-Token": `Bearer ${token}`, "X-Cover-Pregen": pregenKey },
                    // 默认强制 Kolors:Agnes 不认 negative_prompt(400),且其中文理解弱于 Kolors;
                    // 只有显式 --provider auto 才允许回落 Agnes 优先(此时反向词被丢弃,画风会不一致,慎用)
                    body: JSON.stringify({ prompt, negative: NEG_ZH, ratio: "3:4", provider: args.provider || "siliconflow" }),
                    signal: AbortSignal.timeout(180000)
                });
                const d = await res.json().catch(() => ({}));
                if (!res.ok || !d.image) throw new Error(`${res.status} ${d.error || ""} ${d.detail?.genErr || d.genErr || d.detail || ""}`.slice(0, 200));
                const b64 = String(d.image).slice(String(d.image).indexOf(",") + 1);
                fs.writeFileSync(file, Buffer.from(b64, "base64"));
                console.log(`OK   ${rel} ${(Date.now() - start) / 1000}s${attempt ? ` (重试${attempt})` : ""}${d.genErr ? " [" + String(d.genErr).slice(0, 90) + "]" : ""}`);
                filled.push({ name: npc.name, art: STATIC_BASE + rel });
                ok++;
                lastErr = "";
                break;
            } catch (e) { lastErr = String(e).slice(0, 160); }
        }
        if (lastErr) {
            failed++;
            console.log(`FAIL ${npc.name}: ${lastErr}`);
            filled.push({ name: npc.name, art: "" });
        }
    }
    perCard.push({ file: path.join(CARDS_DIR, cf), card, filled });
}

// 回填卡 JSON structured.npcs[i].art(打样模式 --no-refill 或 --outdir 时跳过)
let refilled = 0;
if (!flags.has("no-refill")) {
    for (const { file, card, filled } of perCard) {
        const map = new Map(filled.filter((f) => f.art).map((f) => [f.name, f.art]));
        let chg = false;
        for (const npc of (card.structured.npcs || [])) {
            const a = npc && npc.name ? map.get(npc.name) : "";
            if (a && npc.art !== a) { npc.art = a; chg = true; }
        }
        if (chg) { fs.writeFileSync(file, JSON.stringify(card, null, 2), "utf8"); refilled++; }
    }
}
console.log(`\n完成: 新生成 ${ok} / 失败 ${failed} / 跳过 ${skipped};回填卡 ${refilled}/${perCard.length} 张 → ${OUT_DIR}/`);
