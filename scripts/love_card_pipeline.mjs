// R1 恋爱攻略卡产线(2026-09-09,风格定稿 jp_anime 后启用):PRD §6 两步产卡
//   1. 角色池先行:5 精修人设卡(名字/原型硬编码,LLM 细写)→ {slug}.chars/NN-name.char.json
//   2. 剧情壳:love_mode 卡(top-level love_mode/gender_target,structured 含
//      npcs/love_rules/scenes.heartbeat/world/identity/timeline/scene_style/first_scene{story,options带love+target})
// 用法: node scripts/love_card_pipeline.mjs [--only r1-01-xxx] [--out docs/english-cards] [--api-key 智谱key]
//      [--openings-only] 仅重生成已有卡的 first_scene(开场缺陷返修,不动其余字段,需先删 bilingual 重烤)
// 环境: 模型 glm-4-flash(免费稳定非思考);key 默认读 F:/Claude/zhipu-apikey
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
const KEY = args["api-key"] || fs.readFileSync(process.env.ZHIPU_KEY_FILE || "F:/Claude/zhipu-apikey", "utf8").trim();
const OUT_DIR = args.out || "docs/english-cards";
const MODEL = "glm-4-flash";
const MAX_TOK_CAP = 3900;
const BANDS = ["hs", "cet4", "cet6", "ky", "toefl",
    "ja-n5", "ja-n4", "ja-n3", "ja-n2", "ja-n1",
    "ko-1", "ko-2", "ko-3"];
const LOVE_TAGS = ["flirt", "kind", "tease", "neutral", "awkward", "rude", "reject"];

// ---- 恋爱卡主题池(名字+角色原型硬编码:QC 逐名比对;女向=女主视角 5 男,男向反之) ----
// age 与年龄一致性由 LLM 把握(大学生 18-23,都市 22-30)
const TOPICS = [
    {
        slug: "r1-01-film-club", target: "female", band: "cet4", category: "campus", category_zh: "校园",
        title_seed: "秋季电影社嘉年华前的两周", premise: "新学期转入 Crestwood 大学的大二女生加入电影社,距社团嘉年华还有两周,期间与社团圈的 5 位男生各自展开交集",
        setting: "美国 Crestwood 大学校园(十月金秋)", start: { year: 2026, month: 10, day: 12 },
        identity: { gender: "女", age: 20, role_seed: "转学来的大二生,爱电影与摄影的新社员" },
        names: ["Ethan", "Liam", "Noah", "Marcus", "Owen"],
        archetypes: {
            Ethan: "电影社社长,大四温柔学长,待人如春风,背着旧胶片相机,全校都知道他暗恋过谁都会脸红",
            Liam: "校篮球队队长,大三阳光开朗,训练完总顺路来社团帮忙搬器材,笑容很亮,有点憨的直球",
            Noah: "图书馆常驻的文学系神秘生,借阅卡上永远写着冷门书名,初见疏离,熟后话匣子很多",
            Marcus: "辩论社主将,毒舌腹黑,第一印象难相处,但与你有过一段针锋相对的公共交锋",
            Owen: "艺术学院大二,在社团活动室窗边画速写,安静治愈系,记得你随口说过的每件小事"
        }
    },
    {
        slug: "r1-02-aurora-cafe", target: "female", band: "cet6", category: "生活", category_zh: "生活",
        title_seed: "街角咖啡店的午后常客", premise: "24 岁的女主在 Aurora 街角咖啡馆做咖啡师,街区五位性格迥异的男人常来,秋日午后故事在吧台内外展开",
        setting: "城市 Aurora 街角咖啡馆与周边街区", start: { year: 2026, month: 10, day: 18 },
        identity: { gender: "女", age: 24, role_seed: "街角咖啡馆咖啡师,刚搬来这街区半年,梦想开自己的小店" },
        names: ["Julian", "Alex", "Daniel", "Leo", "Kevin"],
        archetypes: {
            Julian: "楼上旧书店店主,30 岁沉稳温和,每天下午三点来买一杯美式,言谈有旧纸与威士忌的味道",
            Alex: "隔壁健身房教练,28 岁阳光健气,晨练完总来要蛋白奶昔,笑容感染力强,直来直往",
            Daniel: "附近急诊科医生,29 岁,值完大夜班常来续命,温柔靠谱但总被工作占满,眼神里有疲惫与耐心",
            Leo: "独立乐队吉他手,27 岁自由浪漫,晚上演出前来喝热牛奶开嗓,聊起音乐眼睛会发光",
            Kevin: "西装革履的基金分析师,31 岁,嘴毒挑剔却每天都来,某次发现他外套里揣着给流浪猫的罐头"
        }
    },
    {
        slug: "r1-03-photo-club", target: "male", band: "cet4", category: "campus", category_zh: "校园",
        title_seed: "摄影社暗房里的秋季", premise: "大二男主在社团招新周被拉进摄影社,暗房与采风路上与社内 5 位女生各有交集,秋季影展前两周逐渐心动",
        setting: "美国 Crestwood 大学摄影社与城市采风点", start: { year: 2026, month: 10, day: 5 },
        identity: { gender: "男", age: 20, role_seed: "大二男生,本只想混学分却认真爱上按快门,新社员" },
        names: ["Lily", "Mia", "Ava", "Sofia", "Grace"],
        archetypes: {
            Lily: "学生会主席兼摄影社副社,大三,雷厉风行的飒爽学姐,对作品标准极高却会偷偷收藏你的废片",
            Mia: "美术系大三学姐,气质疏离如画中人,专拍人像,约你做模特的那天下午很漫长",
            Ava: "女篮队长,大二,运动系元气少女,快门永远对不准却最爱按,笑得比取景器还亮",
            Sofia: "校园电台主持人,大二,声音温柔治愈,每周三来社里录采访,耳机里外两个人",
            Grace: "数学系学霸,大二,借相机参数当论文写,天然呆,反差萌,全校社团都挖不动她只留在这里"
        }
    },
    // ---- M5 存量回炉打样:保留原卡题材与基础设定,角色池与剧情链换攻略骨架(PRD §5) ----
    {
        slug: "m5-01-first-semester", target: "female", band: "cet4", category: "campus", category_zh: "校园",
        title_seed: "开学第一周:公寓爆管的临时落脚期与初雪前的校园",
        premise: "大一女主独自飞越大洋到 Edgewater 大学报到,抵达当晚就撞上住宿变故;开学第一周一边应付课业与生存琐事,一边与校园和镇上的五位男生各自产生交集",
        setting: "美国东北部虚构小镇 Maple Bay 的 Edgewater University 与镇上(十月初秋,初雪将至)",
        start: { year: 2026, month: 10, day: 1 },
        identity: { gender: "女", age: 18, role_seed: "独自飞越大洋入学的大一国际新生,校外租的公寓因水管爆裂暂不能入住" },
        names: ["Ethan", "Caleb", "Ryan", "Theo", "Nathan"],
        archetypes: {
            Ethan: "华裔大二学长兼临时室友,在中餐馆打夜工,话少心细,出门前会默默把热水壶烧上",
            Caleb: "校报摄影记者,大二,自来熟,爱拉着你跑新闻,把相机塞给你说这次你来按快门",
            Ryan: "冰球队后卫,小镇本地人,看着粗线条,深夜开车送你回去会等你进屋亮了灯才走",
            Theo: "心理学大课的助教,研究生,安静毒舌,改作业的红笔比谁都狠,答疑时却极有耐心",
            Nathan: "镇上旧书店打夜工的艺术生,大三,总在窗边画速写,记得你翻过哪一本书"
        }
    },
    {
        slug: "m5-02-weekend-win", target: "male", band: "cet6", category: "职场", category_zh: "都市职场",
        title_seed: "终面周:科技园区里的咖啡、代码与深夜通勤",
        premise: "刚毕业的男主闯进快速扩张的科技公司 Northgate Labs 的终面周;在通勤、白板面试、深夜路演之间,与公司内外五位女性各自产生交集",
        setting: "现代都市科技园区与市中心(Northgate Labs 及其周边,虚构)",
        start: { year: 2026, month: 9, day: 21 },
        identity: { gender: "男", age: 22, role_seed: "刚毕业的计算机专业学生,正在 Northgate Labs 走终面流程" },
        names: ["Ava", "Rosa", "Chloe", "Iris", "Selina"],
        archetypes: {
            Ava: "人力资源专员,面试流程里的第一张笑脸,专业得体,茶水间里才会露出真实的疲惫",
            Rosa: "技术部门主管,终面考官之一,代码评审不留情面,深夜却在开源社区用另一个 ID 提交补丁",
            Chloe: "同批面试的竞争者兼短租邻居,压力之下从对手慢慢变成同盟",
            Iris: "公司楼下咖啡馆店主,前程序员,每天替你留一杯,记得你面试走到第几轮",
            Selina: "对面联合办公空间的独立开发者,正在做自己的产品,会对你说你该为自己写代码"
        }
    },
    // ---- P3 五卡回炉:保留原卡题材与基础设定,角色池与剧情链换攻略骨架(PRD §5 指派:01/02/05 男向,03/04 女向) ----
    {
        slug: "p3-01-last-desk", target: "male", band: "cet4", category: "校园", category_zh: "校园",
        title_seed: "期末周图书馆:一座难求的座位与闭馆前的那杯咖啡",
        premise: "大二男主在期末周死守图书馆的一个座位;自习、闭馆、深夜通勤之间,与图书馆里遇见的五位女生各自展开交集",
        setting: "美国大学图书馆与校园(十二月期末周,寒冬)",
        start: { year: 2026, month: 12, day: 14 },
        identity: { gender: "男", age: 20, role_seed: "大二男生,期末周图书馆常驻,靠自律和速溶咖啡熬夜" },
        names: ["Maya", "Ivy", "Cora", "Selene", "June"],
        archetypes: {
            Maya: "图书馆学生馆员,大三,安静温柔,管着一架旧书和整层楼的自习秩序,会不动声色地给你留一张'已占用'的纸条",
            Ivy: "理学院学霸,大三,固定坐你邻座,期末周靠黑咖啡续命,嘴上冷淡,却会把整理好的笔记推过来一半",
            Cora: "校门口咖啡车的兼职女生,大二,记得你每天的点单,收摊前会给你留最后一个可颂,笑起来眼睛弯弯",
            Selene: "文学系女生,大三,总在图书馆顶楼角落写小说,夜里才出现,会把你的自习日常悄悄写进她的故事里",
            June: "啦啦队队长,平时精致到不像会来图书馆的人,期末周第一天成了你的'抱佛脚'同桌,反差点满"
        }
    },
    {
        slug: "p3-02-landing-intern", target: "male", band: "cet6", category: "职场", category_zh: "都市职场",
        title_seed: "终面周:科技园区里的三轮面试与深夜咖啡",
        premise: "应届男主闯入快速扩张的科技公司 Vertex Systems 的终面与实习周;面试室、工位、园区咖啡店之间,与公司内外五位女性各自产生交集",
        setting: "现代都市科技园区(虚构 Vertex Systems 及其周边)",
        start: { year: 2026, month: 9, day: 7 },
        identity: { gender: "男", age: 22, role_seed: "刚毕业的软件工程专业学生,正在 Vertex Systems 走终面流程" },
        names: ["Ava", "Rosa", "Nadia", "Zoe", "Vivian"],
        archetypes: {
            Ava: "人力资源专员,26 岁,面试流程里的第一张笑脸,专业得体,茶水间里才会露出真实的疲惫与温柔",
            Rosa: "技术部门主管,32 岁,终面考官之一,代码评审不留情面,深夜却在开源社区用另一个 ID 提交补丁",
            Nadia: "同批面试的竞争者,24 岁,棋逢对手的锋利与骄傲,压力之下从对手慢慢变成同盟",
            Zoe: "公司楼下咖啡店店主,28 岁,前设计师,记得你面试走到第几轮,每天替你留一杯温度刚好的拿铁",
            Vivian: "市场部总监,35 岁,电梯里偶遇的年上系,说话慢条斯理,句句都在考你"
        }
    },
    {
        slug: "p3-03-group-presentation", target: "female", band: "cet4", category: "校园", category_zh: "校园",
        title_seed: "演示前夜:小组掉线之后重新凑齐的人",
        premise: "大三女主在课程小组演示前夜遭遇队友集体失联,一边补位救场,一边重新认识同组与同系的五位男生;校园协作与怦然一起发生",
        setting: "美国 Crestwood 大学校园(十一月,演示周前夕)",
        start: { year: 2026, month: 11, day: 3 },
        identity: { gender: "女", age: 21, role_seed: "大三传媒专业女生,课程小组组长,演示主讲人" },
        names: ["Jake", "Noah", "Felix", "Ian", "Cole"],
        archetypes: {
            Jake: "计算机系大三,小组里沉默的技术担当,话不多,但永远在凌晨三点回你消息:问题已修好",
            Noah: "商学院大三,小组的市场分析师,社交达人,嘴上没个正形,关键时刻却把所有人的锅都背过去",
            Felix: "建筑系大四,完美主义,为演示模型熬到天亮,苛求每一处细节,却会偷偷帮你把你那部分改好",
            Ian: "学生会副主席,大三,临危受命来救场的外援学长,主持功底一流,笑起来有点坏",
            Cole: "体育系大三,被拉来当'气氛组'的篮球队员,看着大大咧咧,其实记得你说的每一句小话"
        }
    },
    {
        slug: "p3-04-flatmates", target: "female", band: "cet6", category: "生活", category_zh: "都市合租",
        title_seed: "合租公寓的第一个秋天:一张账单掀起的边界之争",
        premise: "大三女主与室友合租校外公寓,一张异常的水电账单掀起边界之争;在与室友和邻居男生的相处中,重新划定'界限'与心动",
        setting: "现代都市 Riverside 街区合租公寓与周边(十月末,深秋)",
        start: { year: 2026, month: 10, day: 18 },
        identity: { gender: "女", age: 21, role_seed: "大三女生,合租公寓里负责管理共享账单和公共事务的人" },
        names: ["Ben", "Ahmed", "Devon", "Marco", "Simon"],
        archetypes: {
            Ben: "室友,大三体育生,老实耿直,健身房的常客,账单算不清时最先把钱转过来的人",
            Ahmed: "室友,大三国际生,厨艺好到整层楼都来蹭饭,细心体贴,冰箱里永远给你的那一格留着东西",
            Devon: "隔壁合租的男生,乐队鼓手,作息颠倒,白天睡觉晚上排练,隔着墙敲节奏跟你打招呼",
            Marco: "楼下意式餐厅的兼职服务生,24 岁,总会'不小心'多打包一份甜点带给你,笑容很暖",
            Simon: "房东的侄子,来修东西的水管工,安静可靠,工具箱里常备你随口抱怨过的小零件"
        }
    },
    {
        slug: "p3-05-debate-club", target: "male", band: "hs", category: "校园", category_zh: "校园",
        title_seed: "高中辩论社招新:从替补席到决赛台",
        premise: "高一男主陪朋友去辩论社招新,阴差阳错坐上了替补席;一个学期里,在校内联赛与社团日常中,与五位女生各自交锋又并肩",
        setting: "美国虚构高中 Westbrook High 辩论社与校园(九月招新季)",
        start: { year: 2026, month: 9, day: 21 },
        identity: { gender: "男", age: 16, role_seed: "高一男生,被朋友拉去辩论社招新现场,意外留在了替补席" },
        names: ["Tessa", "Yuki", "Quinn", "Blaire", "Hana"],
        archetypes: {
            Tessa: "高三辩手,队内王牌,逻辑锋利,台上从不让分,台下会把你被驳倒的论点一条条拆给你听",
            Yuki: "高二记录员,安静细致,速记全场论点,赛后会递给你写满批注的笔记,字迹清秀",
            Quinn: "辩论社社长,高三学姐,强势认真,把社团看得比自己重要,招新时一眼看中了替补席上的你",
            Blaire: "对手校的王牌辩手,17 岁,傲慢犀利,赛场上与你针锋相对,赛后却在校门口等你出来",
            Hana: "校报记者部成员,高二,来辩论社采访写稿,相机里存了九张你在台上讲话的照片"
        }
    },
    /* ===== 日语原生卡(方案 B):场景/名字/剧情均为日本本土题材;prose 用日语写,元信息保持中文 ===== */
    {
        slug: "jp-r1-01-bunkasai", target: "female", band: "ja-n4", lang: "ja", category: "campus", category_zh: "校园",
        title_seed: "文化祭までの二週間、映画研究部にて",
        premise: "转学到东京私立高中读高二的女生,为了交到朋友加入了电影研究部;距离文化祭还有两周,要完成一部短片的拍摄,期间与部里的五个男生各自产生交集",
        setting: "东京私立高中「青葉学園」的电影研究部与校园(十一月文化祭前两周)",
        start: { year: 2026, month: 11, day: 8 },
        identity: { gender: "女", age: 17, role_seed: "高二转学生,为了融入新学校加入了电影研究部,负责脚本与场记" },
        names: ["悠真", "蓮司", "湊人", "翔太", "大樹"],
        archetypes: {
            悠真: "电影研究部部长,高三,温柔可靠的学长,拍片时判若两人地严格,私下会把自己的分镜本借给你抄",
            蓮司: "篮球部王牌,高三,训练结束总绕路来活动室帮忙搬器材,爽朗直球,笑起来有点傻气",
            湊人: "图书馆常驻的文学少年,高二,读的都是冷门小说,初见冷淡,熟了以后话很多,会给你写台词建议",
            翔太: "辩论部主力,高二,毒舌腹黑,和你因为活动室使用权吵过一架,却每次都记得你不喝咖啡",
            大樹: "美术部高二,在活动室窗边画分镜草图,安静温和,记得你随口说过的每一件小事"
        }
    },
    {
        slug: "jp-r1-02-kissaten", target: "female", band: "ja-n3", lang: "ja", category: "生活", category_zh: "生活",
        title_seed: "こもれび珈琲店の午後",
        premise: "23 岁的女主在京都老街上的一家喫茶店「こもれび」做店员,入秋后的午后,五位性格各异的常客轮流推开那扇木门,故事在吧台内外慢慢展开",
        setting: "京都老街的喫茶店「こもれび」与周边巷弄(十月末的红叶季)",
        start: { year: 2026, month: 10, day: 24 },
        identity: { gender: "女", age: 23, role_seed: "从大阪搬来京都半年的喫茶店店员,梦想有一天自己开一家小店" },
        names: ["直哉", "匠", "颯太", "涼介", "健人"],
        archetypes: {
            直哉: "巷口旧书店的店主,30 岁,沉稳温和,每天下午三点来点一杯深焙,说话有旧纸和烟草的味道",
            匠: "陶艺家,28 岁,手上总有泥,送来自己烧的杯子给你用,话不多但眼神很直",
            颯太: "自由摄影师,27 岁,旅行回来就带一叠照片贴在店里墙上,笑起来痞气,认真起来会看进你眼睛里",
            涼介: "和果子老铺的年轻职人,26 岁,嘴硬心软,每天清晨送来的生菓子总会多留一份给你",
            健人: "京都大学的学生,22 岁,总在角落写论文,会笨拙地拿作业题来问你,其实只是想搭话"
        }
    },
    {
        slug: "jp-r1-03-ehon-henshuubu", target: "female", band: "ja-n2", lang: "ja", category: "职场", category_zh: "都市职场",
        title_seed: "冬の締め切り、絵本編集部にて",
        premise: "24 岁的女主进入东京一家出版社的绘本编辑部第一年,年底的加印与新人奖截稿期叠在一起,与五位男性在编辑部、印刷厂与深夜的办公室里产生交集",
        setting: "东京神保町的出版社「白鷺社」绘本编辑部(十二月,年末赶稿期)",
        start: { year: 2026, month: 12, day: 7 },
        identity: { gender: "女", age: 24, role_seed: "出版社绘本编辑部入职第一年的新人编辑,负责三位作家与奖项送审" },
        names: ["拓海", "駿", "悠斗", "和也", "大和"],
        archetypes: {
            拓海: "当红绘本作家,29 岁,拖稿成性但交出来的东西令人惊艳,半夜发来原稿时会附一句「ごめんね」",
            駿: "营业部同事,26 岁,跑遍全国书店,会把书店的反馈一条条念给你听,开朗又可靠",
            悠斗: "印刷厂的年轻机长,28 岁,对颜色的执念惊人,为了还原你负责的绘本色调陪你熬了两个通宵",
            和也: "前辈编辑,31 岁,严厉但护人,会在总编问罪时替你挡下,加班后会带你去吃关东煮",
            大和: "装帧设计师,27 岁,安静寡言,谈起纸张与字体就停不下来,第一次见面就记住了你随手画的草图"
        }
    },
    {
        slug: "jp-r1-04-onsen-ryokan", target: "female", band: "ja-n3", lang: "ja", category: "生活", category_zh: "生活",
        title_seed: "湯の宿で過ごす夏",
        premise: "大学一年级的暑假,女主到箱根的温泉旅馆「山みず木」帮忙一个月;夏日的客人、厨房与山道之间,与五位男性各自留下回忆",
        setting: "箱根山间的温泉旅馆「山みず木」(八月,暑假打工的一个月)",
        start: { year: 2026, month: 8, day: 3 },
        identity: { gender: "女", age: 19, role_seed: "大学一年生,暑假到温泉旅馆打工一个月,负责客房与前台接待" },
        names: ["涼太", "誠一", "隼人", "拓真", "亮介"],
        archetypes: {
            涼太: "旅馆的年轻继承人,24 岁,白天穿和服招呼客人,晚上骑摩托带你去山下看便利店和星星",
            誠一: "料理长,33 岁,话少严厉,却会在你打翻托盘后默默多做一份甜点放你房门口",
            隼人: "登山向导,27 岁,皮肤晒得黝黑,带你走未对外开放的山道,讲一路的植物名字",
            拓真: "住在旅馆创作的音乐家,30 岁,傍晚在大堂弹钢琴,只弹给还没下班的你听",
            亮介: "隔壁旅馆的若旦那,25 岁,总来借东西,嘴上不服输,却每次都骑车送你去车站"
        }
    },
    {
        slug: "jp-m1-01-kendo-bu", target: "male", band: "ja-n4", lang: "ja", category: "campus", category_zh: "校园",
        title_seed: "冬の大会、剣道部にて",
        premise: "高中剑道部二年级的男主,在冬季县大会前被推上正选位置;道场与合宿的日常里,与五位女生各自产生羁绊",
        setting: "日本某县立高中剑道部道场与冬季合宿地(十一月,县大会前一个月)",
        start: { year: 2026, month: 11, day: 2 },
        identity: { gender: "男", age: 17, role_seed: "高中剑道部二年级,原本是替补,因主力受伤被推上正选" },
        names: ["葵", "凛", "美咲", "千夏", "結衣"],
        archetypes: {
            葵: "剑道部经理,高二,冷静细致,记着每个人护具的尺寸与旧伤,训练日志写得一丝不苟",
            凛: "同班同学兼文化部素描社,17 岁,总在道场边画你练习的样子,嘴上说只是练手",
            美咲: "剑道部主将,高三学姐,动作干净利落,败给你一次之后开始认真盯你的每一场比赛",
            千夏: "校医室的值班学生,高二,你手上有伤就往校医室跑,她会一边骂你一边给你上药",
            結衣: "隔壁高中的剑道选手,16 岁,赛场上从不留情,赛后却会等在体育馆门口问你要不要一起回去"
        }
    },
    /* ===== 韩语原生卡(方案 B):首尔/全州本土题材;prose 用韩语写,元信息保持中文 ===== */
    {
        slug: "kr-r1-01-golmok", target: "female", band: "ko-2", lang: "ko", category: "生活", category_zh: "生活",
        title_seed: "연남동 골목 카페의 오후",
        premise: "23 岁的女主在首尔延南洞的小咖啡馆「골목」做兼职咖啡师,入秋后的午后,五位常客轮流推开那扇玻璃门,故事在吧台与窗外巷子之间展开",
        setting: "首尔延南洞的咖啡馆「골목」与周边巷弄(十月末)",
        start: { year: 2026, month: 10, day: 20 },
        identity: { gender: "女", age: 23, role_seed: "延南洞咖啡馆的兼职咖啡师,休学一年中,想弄清自己到底想做什么" },
        names: ["지후", "도윤", "시우", "준서", "하준"],
        archetypes: {
            지후: "巷口独立书店的店主,30 岁,沉稳温和,每天下午三点来点一杯手冲,说话像旧纸页的味道",
            도윤: "自由摄影师,28 岁,旅行回来就把照片贴满店里那面墙,笑起来痞气,认真时会看进你眼睛",
            시우: "隔壁烘焙坊的年轻面包师,26 岁,每天清晨送来多留一份的可颂,嘴笨但耳朵会红",
            준서: "弘大独立乐队的吉他手,27 岁,演出前来喝热牛奶开嗓,聊起音乐眼睛会发光",
            하준: "写代码的自由职业者,29 岁,带着笔记本一坐一下午,某天你发现他点的单一直是你随手推荐的那款"
        }
    },
    {
        slug: "kr-r1-02-webtoon", target: "female", band: "ko-3", lang: "ko", category: "职场", category_zh: "都市职场",
        title_seed: "마감 주간의 웹툰 편집부",
        premise: "24 岁的女主进入首尔一家网络漫画平台做新人编辑,连载截稿周与新人奖评审叠在一起,与五位男性在编辑部、工作室与深夜的便利店产生交集",
        setting: "首尔合井洞的网络漫画平台「봄웹툰」编辑部(十二月,截稿周)",
        start: { year: 2026, month: 12, day: 9 },
        identity: { gender: "女", age: 24, role_seed: "网络漫画平台编辑部入职第一年的新人编辑,手上带着两位作家" },
        names: ["태현", "민재", "승우", "건우", "우진"],
        archetypes: {
            태현: "人气连载作家,29 岁,拖稿成性但交出来的分镜令人惊艳,凌晨发来原稿时只附一句「미안」",
            민재: "营业组同事,26 岁,跑遍全国书店与便利店,把读者留言一条条念给你听,开朗可靠",
            승우: "工作室的作画助理,28 岁,对线稿的执念惊人,为了截稿陪你熬了两个通宵",
            건우: "前辈编辑,31 岁,严厉但护人,会在组长问责时替你挡下,加班后带你去吃辣炒年糕",
            우진: "平台的设计师,27 岁,安静寡言,聊起字体与配色就停不下来,第一次见面就记住了你随手画的草图"
        }
    },
    {
        slug: "kr-r1-03-hanokstay", target: "female", band: "ko-1", lang: "ko", category: "生活", category_zh: "生活",
        title_seed: "전주 한옥에서의 한 달",
        premise: "21 岁的女主暑假到全州韩屋村的民宿「소소재」打工换宿一个月;韩屋院子、清晨的酱缸台与附近的街上,与五位男性各自留下回忆",
        setting: "全州韩屋村民宿「소소재」(八月,打工换宿一个月)",
        start: { year: 2026, month: 8, day: 5 },
        identity: { gender: "女", age: 21, role_seed: "大学二年级,暑假到全州韩屋民宿打工换宿,负责整理客房与接送客人" },
        names: ["현우", "지훈", "성민", "태윤", "유찬"],
        archetypes: {
            현우: "民宿主人家的儿子,24 岁,白天帮你修屋檐,傍晚骑摩托带你去市川边看落日",
            지훈: "在民宿长住的木工,30 岁,话少手巧,默默把你房间那扇卡住的窗修好了",
            성민: "来全州拍纪录片的导演,28 岁,镜头总在你不知道的时候对着院子里的你",
            태윤: "韩纸工坊的年轻匠人,26 岁,教你自己做一盏灯,做得糟也说「挺好的」",
            유찬: "隔壁韩食店老板的侄子,23 岁,总来借东西,嘴上不服输,却每次都骑车送你去车站"
        }
    },
    {
        slug: "kr-r1-04-choir", target: "female", band: "ko-2", lang: "ko", category: "campus", category_zh: "校园",
        title_seed: "가을 정기 연주회 전야",
        premise: "大学二年级的女主加入校合唱团,距离秋季定期演奏会还有三周;练习室与深夜的合宿里,与五位男生各自靠近",
        setting: "首尔的大学校园合唱团练习室与演奏会礼堂(十一月,定期演奏会前三周)",
        start: { year: 2026, month: 11, day: 4 },
        identity: { gender: "女", age: 20, role_seed: "大二学生,为了不让自己在校园里消失而加入合唱团,唱女低音" },
        names: ["재현", "우빈", "지호", "태민", "승민"],
        archetypes: {
            재현: "合唱团指挥,大四,排练时严苛得可怕,结束后会把每个人的水杯一只只摆整齐",
            우빈: "男高音部学长,大三,声音干净透亮,教你发声时会站得很近,自己先红了耳朵",
            지호: "钢琴伴奏,大二,安静温和,记得你唱不上去的那个高音,每次都悄悄降半个调",
            태민: "音乐剧社来帮忙的客串指导,26 岁,排舞台走位时爱开玩笑,纠正动作却认真得不行",
            승민: "同系同学,大二,最初只是来送外卖,后来留下来搬椅子,每次都坐最后一排听你唱"
        }
    },
    {
        slug: "kr-m1-01-band", target: "male", band: "ko-2", lang: "ko", category: "campus", category_zh: "校园",
        title_seed: "가을 공연을 앞둔 밴드부",
        premise: "大学二年级的男主被拉进校乐队部,距离秋季公演还有三周;合奏室与深夜排练里,与五位女生各自产生羁绊",
        setting: "首尔的大学校园乐队部合奏室与校外演出场地(十一月,秋季公演前三周)",
        start: { year: 2026, month: 11, day: 6 },
        identity: { gender: "男", age: 20, role_seed: "大二学生,原本只是替朋友顶一次贝斯,结果留在了乐队部" },
        names: ["하은", "서연", "지민", "예린", "수아"],
        archetypes: {
            하은: "乐队部主唱,大三,台上耀眼台下随性,排练时对你的节拍挑剔得毫不留情",
            서연: "键盘手,大二,安静细致,会把每首歌的和弦标好递给你,写满自己的批注",
            지민: "鼓手,大三学姐,干脆利落,演出前会在后台把你的手腕按松,说你紧张得太明显",
            예린: "校刊的摄影记者,大二,来 band 部采访写稿,相机里存了九张你在排练时的照片",
            수아: "校外 Live House 的调音师,23 岁,技术过硬脾气很直,第一次见面就说你的贝斯调不准"
        }
    }
];

// ---- LLM 调用层(P3 同款:JSON ask / 围栏 askText / 1305-429 退避 20s / 5 次重试) ----
async function llm(system, user, maxTok, parse) {
    const body = { model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: Math.min(maxTok, MAX_TOK_CAP), temperature: 0.8 };
    let lastErr = "";
    for (let tryN = 0; tryN < 5; tryN++) {
        try {
            const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
                method: "POST",
                headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error("HTTP " + r.status + " " + JSON.stringify(d.error || {}).slice(0, 160));
            const text = d.choices?.[0]?.message?.content || "";
            if (!text.trim()) throw new Error("空内容");
            const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
            return parse(cleaned);
        } catch (e) {
            lastErr = String(e.message || e);
            const wait = /(429|1305)/.test(lastErr) ? 20000 : 2500 * (tryN + 1);
            if (tryN < 4) console.log("  LLM 重试 " + (tryN + 1) + ": " + lastErr.slice(0, 90) + " (等 " + (wait / 1000) + "s)");
            await new Promise((r) => setTimeout(r, wait));
        }
    }
    throw new Error("LLM 失败: " + lastErr);
}
const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
async function askOnce(system, user, maxTok = 4000) {
    return llm(system, user, maxTok, (raw) => {
        try { return JSON.parse(raw); }
        catch (e) {
            const sq = raw.replace(CTRL, "").replace(/\r/g, "");
            if (sq !== raw) return JSON.parse(sq);
            throw e;
        }
    });
}
// JSON 槽:首轮(含限流退避 5 次);若仍解析失败,带"强制单行 JSON"硬警告换新 prompt 再战一轮
const ONE_LINE_WARN = "\n!!!上一次输出解析失败。强制要求:输出必须是【严格单行 JSON】——整段只能有一行,禁止任何换行与缩进美化;字段值若想分段,一律用空格或句点连接,不得用换行!!!";
async function ask(system, user, maxTok = 4000) {
    let lastErr = null;
    for (let round = 0; round < 2; round++) {
        try { return await askOnce(system, round === 0 ? user : user + ONE_LINE_WARN, maxTok); }
        catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("ask 失败");
}
function askText(system, user, maxTok = 4000) {
    return llm(system, user, maxTok, (raw) => {
        const m = raw.match(/<<<START>>>([\s\S]*?)<<<END>>>/);
        const out = (m ? m[1] : raw).trim();
        if (!out) throw new Error("空文本");
        return stripFences(out);
    });
}
// 围栏残留兜底:模型偶尔不闭合围栏/重复围栏,提取后仍可能有 <<START>> 类标记 → 全局剥离
function stripFences(s) {
    return String(s).replace(/<{2,3}\s*START\s*>{2,3}/gi, " ").replace(/<{2,3}\s*END\s*>{2,3}/gi, " ").replace(/[ \t]{2,}/g, " ").trim();
}

const SYS_BASE = "你是云吞吞文游的恋爱攻略向英语编剧(乙女/逆乙女文游向)。严格遵守输出格式要求,不输出任何格式之外的文字、注释或 markdown 围栏。";
const SYS_TEXT = "你是云吞吞文游的恋爱攻略向英语编剧。长文本用围栏包裹(围栏之外不要任何东西):\n<<<START>>>\n内容\n<<<END>>>";

/* ---- 语种层(en 分支的提示词字符串与旧版逐字一致,英语卡行为不变) ----
   字段语种约定(与 index.html 运行时提示词一致,2026-09-21 实测):
     prose 用目标语 = title / text / world.summary / world.rules / identity.background /
                      npcs[].personality / first_scene.story / first_scene.options
     元信息仍中文 = world.era|genre|atmosphere / identity.role|gender / npcs[].role /
                      title_zh / category_zh / timeline.note
   运行时已声明"设定文本里的中文是 METADATA,出现时翻译",故元信息保持中文是安全的。 */
const CJK = /[一-鿿]/g;
function cjkCount(s) { return (String(s).match(CJK) || []).length; }
const KANA = /[ぁ-ゖァ-ヺー]/g;
const HANGUL = /[가-힣]/g;
const HAN = /[一-龯々]/g;
// 简体专有字(日语正字不用,与日文新字体字形不同):出现即说明日卡正文混进了中文
const ZH_ONLY = /[们这说对时见电语书长门问间关该东车认让请词试题网页为发买卖爱边变记讲话谁谢还进远运过选邻银钱错闻听厉显从众优场单简轮键录责级织张应达团围图园圆绿线练终经结给统绝继维缩续联职觉观规视览议论诉识译谈课读红约纯纸细转软较载输违连迟适递锁汉汤满么无]/g;
const hitsOf = (s, re) => (String(s || "").match(re) || []).length;

const BAND_DESC = {
    en: { hs: "高中大纲", cet4: "CET-4 大纲", cet6: "CET-6 大纲", ky: "考研大纲", toefl: "托福高频" },
    ja: { "ja-n5": "JLPT N5", "ja-n4": "JLPT N4", "ja-n3": "JLPT N3", "ja-n2": "JLPT N2", "ja-n1": "JLPT N1" },
    ko: { "ko-1": "TOPIK 1 级", "ko-2": "TOPIK 2 级", "ko-3": "TOPIK 3 级" }
};
const bandZh = (lg, b) => (BAND_DESC[lg] && BAND_DESC[lg][b]) || b;

const LG = {
    en: {
        label: "英语",
        sysBase: SYS_BASE,
        sysText: SYS_TEXT,
        tone: (t) => "写作语言全英文;人称用 you(玩家);短句为主,对话自然浪漫不油腻,词汇全部限制在" + bandZh("en", t.band) + "以内,像真实英语青春小说。",
        warn: "\n(硬性检查:内容必须 100% 纯英文,任何中文/日文字符都算失败!)",
        // 纯净度:英语正文里中文字符 ≤2 即算干净
        impure: (s) => cjkCount(s) > 2 ? "含中文 " + cjkCount(s) + " 字" : "",
        clean: (s) => cjkCount(s) <= 2,
        len: (s) => String(s || "").split(/\s+/).filter(Boolean).length,
        unit: "词",
        textMin: 800,                       // text 设定下限(词)
        story: { lo: 300, hi: 500, want: "340-420 词", fix: "380-440 词" },
        titleRule: "英文标题≤5词",
        charLang: "英文",
        hanja: false
    },
    ja: {
        label: "日语",
        sysBase: "你是云吞吞文游的恋爱攻略向日语编剧(乙女/逆乙女文游向)。严格遵守输出格式要求,不输出任何格式之外的文字、注释或 markdown 围栏。",
        sysText: "你是云吞吞文游的恋爱攻略向日语编剧。长文本用围栏包裹(围栏之外不要任何东西):\n<<<START>>>\n内容\n<<<END>>>",
        tone: (t) => "写作语言全日语(汉字假名混排,句读用。、!? 与「」);叙述一律第二人称,称呼玩家用 あなた/きみ/名字+さん(按角色性格与亲疏决定);短句为主,台词自然、心动感靠细节不靠形容词堆砌;词汇限制在" + bandZh("ja", t.band) + " 以内(超出该级别的词换成更常用的说法),像日本青春小说与少女漫画。",
        warn: "\n(硬性检查:正文必须是纯日语——汉字假名混排;严禁出现简体中文专有字(们/这/说/语/书…)、谚文、以及整句英文!)",
        impure: (s) => {
            const kana = hitsOf(s, KANA), han = hitsOf(s, HAN), hangul = hitsOf(s, HANGUL), zh = hitsOf(s, ZH_ONLY);
            if (hangul) return "混入谚文 " + hangul + " 字";
            if (zh) return "混入简体中文专有字 " + zh + " 个";
            const body = kana + han;
            if (body < 40) return "正文过短无法判语种";
            if (kana / body < 0.22) return "假名占比过低(" + (kana / body * 100).toFixed(0) + "%),疑似中文";
            return "";
        },
        clean: (s) => {
            const kana = hitsOf(s, KANA), han = hitsOf(s, HAN);
            return hitsOf(s, HANGUL) === 0 && hitsOf(s, ZH_ONLY) === 0 && kana + han >= 40 && kana / (kana + han) >= 0.22;
        },
        len: (s) => (String(s || "").match(/[^\s]/g) || []).length,
        unit: "字",
        textMin: 1800,
        story: { lo: 620, hi: 1100, want: "700-950 字", fix: "850-1000 字" },
        titleRule: "日文标题≤14字(可用汉字假名,不要英文)",
        charLang: "日文",
        hanja: false
    },
    ko: {
        label: "韩语",
        sysBase: "你是云吞吞文游的恋爱攻略向韩语编剧(乙女/逆乙女文游向)。严格遵守输出格式要求,不输出任何格式之外的文字、注释或 markdown 围栏。",
        sysText: "你是云吞吞文游的恋爱攻略向韩语编剧。长文本用围栏包裹(围栏之外不要任何东西):\n<<<START>>>\n内容\n<<<END>>>",
        tone: (t) => "写作语言全韩语(谚文,按韩语正字法分写);叙述一律第二人称,称呼玩家用 당신/너/이름+씨(按角色性格与亲疏决定,对话里按关系用 해요체/반말);短句为主,台词自然;词汇限制在" + bandZh("ko", t.band) + " 以内,像韩国青春小说与网络小说。",
        warn: "\n(硬性检查:正文必须是纯韩语谚文;严禁出现假名、汉字(한자 不用)、简体中文专有字、以及整句英文!)",
        /* 汉字阈值必须是 0,不能像旧版那样留 3 的余量:正文是多段 genCleanBlock 拼接出来的
           (genText 4 段 + first_scene.story),闸门按「段」判定而质检按「拼接后的全文」判定,
           两边阈值相同也照样被拼接放大击穿——每段各带 3 个,4 段就是 10+ 个,直接卡在终局质检,
           而质检阶段没有任何返修路径,整卡作废。段级闸门只有取 0,拼接后才是 0。 */
        impure: (s) => {
            const hangul = hitsOf(s, HANGUL), kana = hitsOf(s, KANA), han = hitsOf(s, HAN), zh = hitsOf(s, ZH_ONLY);
            if (kana) return "混入假名 " + kana + " 字";
            if (zh) return "混入简体中文专有字 " + zh + " 个";
            if (han) return "混入汉字 " + han + " 字(韩语正文不用汉字)";
            if (hangul < 40) return "正文过短无法判语种";
            if (hangul / (hangul + han) < 0.9) return "谚文占比过低,疑似中文/日文";
            return "";
        },
        clean: (s) => {
            const hangul = hitsOf(s, HANGUL);
            return hitsOf(s, KANA) === 0 && hitsOf(s, ZH_ONLY) === 0 && hitsOf(s, HAN) === 0 && hangul >= 40;
        },
        len: (s) => (String(s || "").match(/[^\s]/g) || []).length,
        unit: "字",
        textMin: 1800,
        story: { lo: 650, hi: 1150, want: "750-1000 字", fix: "900-1100 字" },
        titleRule: "韩文标题≤14자(纯谚文,不要英文)",
        charLang: "韩文",
        hanja: false
    }
};
const LANG_OF = (t) => String((t && t.lang) || "en").trim().toLowerCase();
function assertLangSupported(t) {
    const lg = LANG_OF(t);
    if (!LG[lg]) throw new Error(`主题 ${t.slug} 的 lang=${lg}:产线只支持 en/ja/ko`);
    return lg;
}
const S = (t) => LG[LANG_OF(t)];                       // 取该主题的语种规格
// 角色名匹配:拉丁名用词边界,中日韩名直接 includes(汉字无 \b)
const nameHit = (text, name, lg) => lg === "en" ? new RegExp("\\b" + name + "\\b", "i").test(String(text || "")) : String(text || "").includes(String(name));

// 脏行判定:含简体中文专有字(主要病灶)或异语脚本。行级(非整段)因为污染通常只发生在
// 表头、混入短语这类局部位置——整段重写代价大且模型往往在同处再犯。
function dirtyLine(lg, line) {
    const s = String(line);
    if (!s.trim()) return false;
    if (hitsOf(s, ZH_ONLY)) return true;
    if (lg === "ja") return hitsOf(s, HANGUL) > 0;
    // ko 这里曾写 HAN > 2,导致汉字每行只漏 1 个时没有任何一行算脏 → idx 为空 →
    // 局部返修一次都不尝试,直接堕入整段重写(模型往往同处再犯)。阈值降到 1 个即脏。
    return hitsOf(s, KANA) > 0 || hitsOf(s, HAN) > 0;
}
// 含中文行局部返修:抽出脏行 → 让模型逐行改写成纯目标语 → 按行号原位替换。
// 只替换对得上号的行;污染面过大或返回不可解析时返回 null,交给整段重试兜底。
async function repairDirtyLines(t, raw) {
    const sp = S(t), lg = LANG_OF(t);
    const lines = String(raw).split("\n");
    const idx = [];
    for (let i = 0; i < lines.length; i++) if (dirtyLine(lg, lines[i])) idx.push(i);
    if (!idx.length || idx.length > 24) return null;
    const payload = idx.map((i, k) => `${k + 1}|${lines[i].trim()}`).join("\n");
    // 指名到字:只差一两个中文字时,模型看不出哪个字不是日语,泛指"混入中文"它改不动
    const badChars = [...new Set(idx.flatMap((i) => (lines[i].match(/[一-鿿가-힣ぁ-ゖァ-ヺー]/g) || []))
        .filter((c) => hitsOf(c, ZH_ONLY) || (lg === "ja" ? hitsOf(c, HANGUL) : hitsOf(c, KANA))))].join("");
    const d = await askText(sp.sysText,
        `下面这段${sp.label}文本里有几行混进了中文或其他语种的字` + (badChars ? `,问题字就是这些:「${badChars}」` : "") + `。\n` +
        `请逐行把它们改成语义等价的纯${sp.label}:意思、语气、行内格式(如表格竖线、编号、缩进)全部保持不变,只把文字换成${sp.label},并保证改写后一个中文专有字都不剩。\n` +
        `逐行输出,格式为「编号|改写后的行」,编号与顺序必须和输入完全一致,不许增删行,不许解释:\n${payload}\n` +
        `直接输出这些行,外面不要加任何其他内容。`, 4000);
    const map = new Map();
    for (const ln of String(d || "").split("\n")) {
        const m = ln.match(/^\s*(\d+)\s*[|｜]\s*(.*)$/);
        if (m) map.set(Number(m[1]), m[2]);
    }
    if (!map.size) return null;
    const out = lines.slice();
    idx.forEach((i, k) => { const v = map.get(k + 1); if (v !== undefined && v.trim()) out[i] = v; });
    return out.join("\n");
}

async function genCleanBlock(t, label, doAsk) {
    const sp = S(t);
    let extra = "";
    for (let i = 0; i < 3; i++) {
        const raw = await doAsk(i > 0 ? sp.warn + extra : "");
        if (raw && sp.clean(raw)) return raw;
        // 先试局部返修:表头/短语级污染用它救回整段,避免为几行脏字丢掉全部内容
        if (raw && LANG_OF(t) !== "en") {
            const fixed = await repairDirtyLines(t, raw).catch(() => null);
            if (fixed && sp.clean(fixed)) { console.log(label + "  局部返修成功"); return fixed; }
        }
        const why = sp.impure(raw) || "空内容";
        const hits = (String(raw || "").match(/[^\n]*[一-鿿가-힣ぁ-ゖァ-ヺー][^\n]*/g) || []).slice(0, 3).map((l) => l.trim().slice(0, 120)).join(" ⏎ ");
        // 泛泛说"禁止中文"对 flash 无效:把上一版被抄进正文的原文回喂,指名禁止
        extra = hits ? `\n!!!上一版你把下面这段中文原样抄进了正文,这一版绝对不许再出现这些字:\n${hits}\n` : "";
        console.log(label + "  " + why + ",重试…" + (hits ? " [" + hits + "]" : ""));
    }
    throw new Error("三次生成均不纯净(" + sp.label + ")");
}

// ---- 槽位 1:标题 ----
async function genTitle(t) {
    const sp = S(t);
    const d = await ask(sp.sysBase,
        sp.tone(t) + `\n为恋爱攻略${sp.label}卡起名(标题体现场景与心动钩子,不剧透结局):\n场景:${t.title_seed}\n` +
        `输出单行 JSON:{"title":"${sp.titleRule}","title_zh":"中文标题≤8字"}`, 1500);
    return { title: String(d.title || "").trim().slice(0, 60), title_zh: String(d.title_zh || "").trim().slice(0, 30) };
}

// ---- 槽位 2:5 精修人设卡(一卡一角色,appearance_en 将作立绘 prompt 素材) ----
const CHAR_FIELDS = "{\"role_zh\":\"身份一句话(中文)\",\"age\":数字,\"appearance_en\":\"英文外貌 12-22 词纯外貌短句:体型身高/发色发型/瞳色/衣着/气质,直接可作 AI 绘画 prompt 主体\",\"personality_zh\":\"中文性格 2-3 句(含说话习惯)\",\"personality_en\":\"英文性格 2-3 句(说话习惯/口头禅)\",\"hobby_en\":\"英文兴趣 1 句\",\"redline_en\":\"英文雷区 1 句\",\"soft_en\":\"英文心动点 1 句(会被什么打动)\",\"speech_en\":\"英文称呼习惯 1 句(ta 怎么称呼你/常用语气)\",\"relationship_zh\":\"与玩家初始关系一句话(中文)\"}";
// 日/韩:appearance_en 仍走英文(立绘 prompt 素材),性格类字段走目标语(npcs[].personality 要进设定正文)
const CHAR_FIELDS_T = (lg) => `{"role_zh":"身份一句话(中文)","age":数字,"appearance_en":"英文外貌 12-22 词纯外貌短句:体型身高/发色发型/瞳色/衣着/气质,直接可作 AI 绘画 prompt 主体","personality_zh":"中文性格 2-3 句(含说话习惯,供人工审阅)","personality_t":"${lg}性格 2-3 句(说话习惯/口癖,纯${lg},严禁中文)","hobby_t":"${lg}兴趣 1 句","redline_t":"${lg}雷区 1 句","soft_t":"${lg}心动点 1 句(会被什么打动)","speech_t":"${lg}称呼习惯 1 句(ta 怎么称呼你/常用语气)","relationship_zh":"与玩家初始关系一句话(中文)"}`;
async function genCharCard(t, name, arch) {
    const sp = S(t);
    const lg = LANG_OF(t);
    const isT = lg !== "en";
    const KEYS = ["personality_t", "hobby_t", "redline_t", "soft_t", "speech_t"];
    let d = null, warn = "";
    for (let i = 0; i < 3; i++) {
        d = await ask(sp.sysBase,
            sp.tone(t) + `\n为恋爱攻略卡《${name} 的人设卡》细写角色「${name}」。该卡为${t.target === "female" ? "女向(玩家为女主)" : "男向(玩家为男主)"}攻略卡,${name} 是 5 个可攻略对象之一。\n` +
            `题材:${t.category_zh};场景:${t.setting}。\n角色原型(不得偏离):${arch}\n` +
            `注意:${name} 是让人向往的${t.target === "female" ? "男性" : "女性"},魅力点要有层次。写外貌时突出可画性(半身像构图友好)。\n` +
            (isT ? `除 role_zh / personality_zh / relationship_zh / age / appearance_en 外,其余字段一律用纯${sp.charLang}写,禁止混入中文。\n` : "") +
            `输出单行 JSON:${isT ? CHAR_FIELDS_T(sp.charLang) : CHAR_FIELDS}` + warn, 2500);
        const bad = isT ? await fixFields(t, d, KEYS) : [];
        if (!bad.length) break;
        console.log("  人设卡 " + name + " 字段脏: " + bad.join("/") + ",重问…");
        warn = `\n!!!上一版这些字段混进了中文,这一版必须写成纯${sp.charLang},一个汉字都不许剩:${bad.join("、")}!!!`;
    }
    const T = (k) => String(d[k + (isT ? "_t" : "_en")] || "").trim() || String(d[k + "_en"] || "").trim();
    return {
        name, gender: t.target === "female" ? "男" : "女",
        role_zh: d.role_zh, age: d.age, appearance_en: d.appearance_en,
        personality_zh: d.personality_zh, personality_t: T("personality"),
        hobby_t: T("hobby"), redline_t: T("redline"), soft_t: T("soft"), speech_t: T("speech"),
        relationship_zh: d.relationship_zh
    };
}

// ---- 槽位 3:text 设定(3 段接力;People 段按人设卡写 5 人;Arc 攻略向三幕) ----
async function genText(t, title, chars) {
    const sp = S(t);
    const lg = LANG_OF(t);
    const charLines = chars.map((c) => `- ${c.name}:${c.personality_t}${c.hobby_t ? " 兴趣:" + c.hobby_t : ""}${c.soft_t ? " 心动点:" + c.soft_t : ""}${c.redline_t ? " 雷区:" + c.redline_t : ""}${c.speech_t ? " 称呼习惯:" + c.speech_t : ""}`).join("\n");
    const SEGS = lg === "en" ? [
        { n: 320, spec: "## Premise(3 句:主角是谁、此刻什么处境、想要什么)\n## The World(世界观 2-3 段,只含本卡相关范围:地点/人群/社团节奏)" },
        { n: 420, spec: `## People(恰好 5 人:${t.names.join("/")},顺序即登场顺序,不许改名/加人/漏人。每人 3-4 行,不要抄录下面人设卡原文,写:TA 在故事中的角色位置/你们最初如何相遇/相处时最鲜明的互动氛围):\n角色素材:\n${charLines}` },
        { n: 330, spec: "## Love Routes — meeting phase: 4-5 rounds in which the player naturally meets and lightly bonds with all five candidates one scene at a time; name each candidate's route hook in 1-2 lines (where that route leads, what unlocks closeness with that person). Heating phase: 5-6 rounds of deepening, the player may pursue 1-2 of the routes (3 concurrent lines max, the player decides whom to approach). Name at least 3 heartbeat-moment triggers (place + timing + mood, e.g. alone in the club room after a shared task, walking home together after rain, backstage before the show). Lock-line note: once one bond passes the threshold the others naturally step back into the background. Ending notes: HE = confessed mutual love with a proper confession scene; BE = warm affection that ends in a missed goodbye; the ending must contain a confession or farewell scene." },
        { n: 230, spec: "## Round map — list roughly 13-16 rounds as a simple table (use pipes or hyphens): round number | scene keyword | characters present. Finish with the ideal final round for a confession." }
    ] : lg === "ja" ? [
        { n: 520, heads: "## 前提\n## 世界観", reqs: "前提 3 文:主人公は誰で、今どんな状況にいて、何を望んでいるか。\n世界観 2-3 段落:このカードに関わる範囲だけ——場所・人々・部活や職場のリズム。" },
        { n: 700, heads: "## 登場人物", reqs: `恰好 5 人(${t.names.join("/")}),顺序即登场顺序,不许改名/加人/漏人。每人 3-4 行,不要抄录下面人设卡原文,每人就写这三点:①この物語の中での立場 ②あなたとの最初の出会い ③二人でいるときの空気感。\n角色素材:${charLines}` },
        { n: 650, heads: "## 恋のルート", reqs: "二部构成:出会い編と接近編。\n出会い編 4-5 轮,玩家一轮一场景自然结识 5 位候选并各自轻微靠近;每条线 1-2 行,写明そのルートがどこへ向かうのか、何が二人の距離を縮めるのか。\n接近編 5-6 轮加深关系;玩家可主攻 1-2 条线(最多 3 条并行,由玩家决定靠近谁)。\n心が動く瞬間のきっかけを最低 3 つ名指しする,地点+时机+氛围(例:共事后只剩两人的活动室、雨里一起回家、演出前的后台)。\n锁线说明:一旦某条线越过阈值,其余自然退为背景。\n结局说明:HE=互相告白且有正式告白场景;BE=温情却错过的告别;结局必须含告白或告别场景。" },
        { n: 380, heads: "## ラウンド表\n| 回 | シーン | 登場人物 |\n| --- | --- | --- |", reqs: "13-16 行表体,末行写告白轮。" }
    ] : [
        { n: 520, heads: "## 전제\n## 세계관", reqs: "전제 3 문장:주인공은 누구이고, 지금 어떤 처지이며, 무엇을 바라는가。\n세계관 2-3 문단:이 카드와 관련된 범위만——장소, 사람들, 동아리나 직장의 리듬。" },
        { n: 700, heads: "## 등장인물", reqs: `恰好 5 人(${t.names.join("/")}),顺序即登场顺序,不许改名/加人/漏人。每人 3-4 行,不要抄录下面人设卡原文,每人就写这三点:①이 이야기 속에서의 위치 ②당신과의 첫 만남 ③둘이 있을 때의 분위기。\n角色素材:${charLines}` },
        { n: 650, heads: "## 연애 루트", reqs: "두 부 구성:만남 편과 가까워짐 편。\n만남 편 4-5 轮,玩家一轮一场景自然结识 5 位候选并各自轻微靠近;각 루트마다 1-2 행으로 그 길이 어디로 향하는지, 무엇이 두 사람을 가깝게 하는지 쓴다。\n가까워짐 편 5-6 轮加深关系;玩家可主攻 1-2 条线(最多 3 条并行,由玩家决定靠近谁)。\n가슴이 뛰는 순간의 계기를 최소 3 개 집어낸다,地点+时机+氛围。\n锁线说明:一旦某条线越过阈值,其余自然退为背景。\n结局说明:HE=互相告白且有正式告白场景;BE=温情却错过的告别;结局必须含告白或告别场景。" },
        { n: 380, heads: "## 라운드 표\n| 회차 | 장면 | 등장인물 |\n| --- | --- | --- |", reqs: "13-16 行表体,末行写告白轮。" }
    ];
    const headWarn = lg === "en" ? "" : `\n【本段的小节标题与正文每一个字都必须是${sp.label}。上文出现的任何中文——场景种子、写作要求、角色素材、元信息——都只是给你理解用的说明,一个字都不许抄进正文。】`;
    let acc = "";
    for (const seg of SEGS) {
        const want = seg.heads
            ? `本段要写的小节(标题原样照写):\n${seg.heads}\n\n写作要求(中文说明,只供你理解,严禁抄进正文):\n${seg.reqs}${headWarn}`
            : seg.spec + headWarn;
        const piece = await genCleanBlock(t, seg.n + "+", (warn) => askText(sp.sysText,
            `卡《${title}》${sp.label}恋爱攻略设定,分段协作写作,你只写其中一段;小节标题用 ## 开头。\n` +
            sp.tone(t) + warn + `\n场景种子:${t.premise}。地点:${t.setting}。攻略对象名单(5 人,顺序即登场顺序):${t.names.join("/")}。\n` +
            (acc ? `前方已写内容(不要重复,顺着风格往下写):\n${acc.slice(-1500)}\n` : "") +
            `本段内容要求(从 ## 小节标题开始写):\n${want}\n` +
            `本段应约 ${seg.n} ${sp.unit}:写完后自己数一遍${sp.unit}数,不足 ${Math.round(seg.n * 0.85)} ${sp.unit} 就继续充实细节直到达标再收尾。`, 9000));
        acc = (acc ? acc + "\n\n" : "") + piece;
        console.log("  seg " + sp.len(piece) + " " + sp.unit);
    }
    return acc;
}

// ---- 槽位 4:世界元信息 + 心动场景定义 ----
async function genWorldMeta(t, title, textHead) {
    const HB_WARN = "\n!!!上一次心动场景不足 3 个。必须恰好给 3 个,分别对应五位攻略对象中不同的人与不同场地,禁止只写 1 个或凑数重复!!!";
    const sp = S(t), lg = LANG_OF(t);
    const worldSpec = lg === "en"
        ? `{"era":"时代/地域一句话(中文)","genre":"题材标签(中文,如:校园恋爱)","summary":"英文 4-6 句世界观综述(纯英文)","rules":"该世界对主角的 3-4 条规则(中文)","atmosphere":"氛围(中文)","vocab":["8 个本卡核心考点词(贴合${t.band})"]}`
        // 日/韩:era/genre/atmosphere 是引擎元信息(中文),summary/rules/vocab 属于设定正文(目标语)
        : `{"era":"时代/地域一句话(中文)","genre":"题材标签(中文,如:校园恋爱)","summary":"${sp.label} 4-6 句世界观综述(纯${sp.label},禁止中文)","rules":"该世界对主角的 3-4 条规则(用${sp.label}写,禁止中文)","atmosphere":"氛围(中文)","vocab":["8 个本卡核心考点词(贴合 ${bandZh(lg, t.band)},词形用${sp.label})"]}`;
    let d = null, warn = "";
    for (let i = 0; i < 3; i++) {
        d = await ask(sp.sysBase,
            `卡《${title}》设定前段:\n${textHead}\n` +
            `输出单行 JSON:{"world":${worldSpec},"heartbeats":[{"where":"心动时刻地点(中文)","when":"触发时机/情绪条件(中文)"}]}\n` +
            `heartbeats 必须恰好 3 个(攻略卡的核心心动节点):地点与情绪条件各不相同,覆盖不同攻略对象与不同场地。` + (i > 0 ? HB_WARN : "") + warn, 5000);
        const hb = Array.isArray(d?.heartbeats) ? d.heartbeats.length : 0;
        if (hb < 3) { console.log("  heartbeats " + hb + " 个,重问…"); continue; }
        if (lg === "en") break;
        const bad = [...await fixFields(t, d.world, ["summary", "rules"]), ...await fixVocab(t, d.world)];
        if (!bad.length) break;
        console.log("  world 字段脏: " + bad.join("/") + ",重问…");
        warn = `\n!!!上一版这些字段混进了中文,这一版必须写成纯${sp.label},一个汉字都不许剩:${bad.join("、")}!!!`;
    }
    return d;
}

// ---- 槽位 5:主角 identity ----
async function genIdentity(t, title, textHead) {
    const sp = S(t), lg = LANG_OF(t);
    const nameSpec = lg === "en" ? "英文名" : `${sp.charLang}名字(姓与名都要像本国人,不要英文名)`;
    const bgSpec = lg === "en" ? "英文 2-3 句背景(纯英文)" : `${sp.label} 2-3 句背景(纯${sp.label},禁止中文)`;
    let d = null, warn = "";
    for (let i = 0; i < 3; i++) {
        d = await ask(sp.sysBase,
            `卡《${title}》(${t.target === "female" ? "女向:玩家是女主" : "男向:玩家是男主"}):为主角定身份。参考前面设定,玩家以第二人称存在。\n${textHead}\n` +
            `输出单行 JSON:{"name":"${nameSpec}","gender":"${t.identity.gender}","age":${t.identity.age},"role":"${t.identity.role_seed}(role 字段必须原样保留这段中文,禁止翻译)","background":"${bgSpec}"}` + warn, 2000);
        const obj = d.identity || d;
        const bad = lg === "en" ? [] : await fixFields(t, obj, ["background"]);
        if (!bad.length) break;
        console.log("  identity 字段脏: " + bad.join("/") + ",重问…");
        warn = `\n!!!上一版的 background 混进了中文,这一版必须写成纯${sp.label},一个汉字都不许剩!!!`;
    }
    return d.identity || d;
}

// ---- 槽位 6:开场(双语 story 围栏 + options JSON 带 love 标签与 target) ----
const lenOf = (t, s) => S(t).len(s);
// 开场越界检测:①正文出现 "1." "2." 编号行;②写出了"决定已做出"式收束 —— 两者都等于把选项/选择后果写进了正文(开场必须停在选择前)
const storyOvershoot = (s) => /(^|\n)\s*[0-9０-９]+\s*[.)、．]\s*\S/.test(String(s || "")) ||
    /\b(decision|choice)\b[^.!?]{0,24}\balready (?:been )?(?:made|decided)\b/i.test(String(s || "")) ||
    /(もう)?(決めてしまった|決断はすでに|選択はすでに|すでに決めた)/.test(String(s || "")) ||
    /(이미\s*결정|선택은\s*이미|이미\s*선택)/.test(String(s || ""));
// 短文本(选项/词形)的语种纯净度:不适用整段占比阈值,改按"不得出现异语字符 + 本语字符存在"判定
const shortOk = (lg, s) => {
    const t = String(s || "");
    const n = [...t].length;
    if (lg === "en") return cjkCount(t) === 0;
    if (lg === "ja") return hitsOf(t, HANGUL) === 0 && hitsOf(t, ZH_ONLY) === 0 &&
        hitsOf(t, KANA) + hitsOf(t, HAN) >= 1 && (n < 6 || hitsOf(t, KANA) >= 1);
    // 短字段(标题/选项/vocab 词)同样收到 0:它们会直接展示给玩家,留 1 个汉字余量
    // 就会出现「选项中混一个中文词」这种肉眼可见的脏
    return hitsOf(t, KANA) === 0 && hitsOf(t, ZH_ONLY) === 0 && hitsOf(t, HAN) === 0 && hitsOf(t, HANGUL) >= 1;
};
/* 字段级纯净度:整段判定对短字段会报"正文过短无法判语种"(那本来是给全文用的护栏),
   而 personality/background 这类字段天然只有一两句——过短时改按短文本口径判,避免好字段被误杀 */
function fieldWhy(lg, sp, v) {
    const t = String(v || "").trim();
    if (!t) return "";
    const w = sp.impure(t);
    if (!w) return "";
    if (w.indexOf("正文过短") === 0) return shortOk(lg, t) ? "" : w;
    return w;
}
/* 字段级纯净返修:genCharCard / genWorldMeta / genIdentity 走的是裸 ask(),字段不经 genCleanBlock
   的闸门 → 生成期无人校验,只有终局 QC 的 fieldWhy/shortOk 会拦,而 QC 阶段没有返修路径,
   整卡直接作废(实测 jp-r1-04 的 npcs[4].personality、kr-r1-02 的 npcs[0].personality 都死在这里)。
   就地返修目标语字段,能修好就改掉;返回仍脏的字段名(空数组=全干净),调用方据此重问。 */
async function fixFields(t, obj, keys) {
    const sp = S(t), lg = LANG_OF(t);
    if (lg === "en" || !obj) return [];
    const bad = [];
    for (const k of keys) {
        const v = obj[k];
        if (typeof v !== "string" || !v.trim()) continue;
        if (!fieldWhy(lg, sp, v)) continue;
        const fixed = await repairDirtyLines(t, v).catch(() => null);
        if (fixed && !fieldWhy(lg, sp, fixed)) obj[k] = fixed;
        else bad.push(k);
    }
    return bad;
}
// vocab 是短词数组,逐词过 shortOk;返修时按行拼回去,行数对不上就整体交回重问
async function fixVocab(t, world) {
    const lg = LANG_OF(t);
    const vs = Array.isArray(world && world.vocab) ? world.vocab : null;
    if (lg === "en" || !vs) return [];
    const badIdx = [];
    vs.forEach((w, i) => { const s = String(w || "").trim(); if (s && !shortOk(lg, s)) badIdx.push(i); });
    if (!badIdx.length) return [];
    const fixed = await repairDirtyLines(t, badIdx.map((i) => String(vs[i]).trim()).join("\n")).catch(() => null);
    if (fixed) {
        const rep = fixed.split("\n").map((x) => x.trim()).filter(Boolean);
        if (rep.length === badIdx.length) { badIdx.forEach((i, k) => { vs[i] = rep[k]; }); return []; }
    }
    return badIdx.map((i) => "vocab:" + vs[i]);
}
async function genFirstScene(t, title, text, chars, playerName) {
    const sp = S(t), lg = LANG_OF(t);
    const base = `卡《${title}》完整设定:\n${text.slice(0, 4600)}\n`;
    const roleLines = Array.isArray(chars) ? chars.filter((c) => c && c.name).map((c) => `- ${c.name}:${String(c.role_zh || c.role || "").slice(0, 60)}`).join("\n") : "";
    const SPEC = lg === "en"
        ? `写开场故事:全程第二人称——叙述句主语一律是 you,严禁用第三人称讲述主角("She steps into…"这类句子整段作废)。开始于设定时间点前几分钟,现在时,340-420 词,停在「你必须立刻做选择」的节骨眼,不展开后续。` +
        `开场要让玩家与至少 2 位攻略对象${t.names[0]}/${t.names[1]}自然相遇(可按名字写,${t.names[0]}${t.names[1]}必须真人出场且有台词)。\n` +
        (roleLines ? `出场角色身份(严禁写错身份:面试官别写成同批竞争者、店员别写成同事;下方身份描述可能含中文,仅供你理解角色定位,正文严禁出现任何中文):\n${roleLines}\n` : "") +
        (playerName ? `主角名字是 ${playerName}:只允许出现在别人对主角的称呼里(如 "Hi, ${playerName}!"),叙述句里一律用 you。\n` : "") +
        `句长 8-15 词为主,对话自然,营造心动感的画面细节。`
        : `写开场故事:全程主角视角的现在时叙述(纯${sp.label}),严禁用第三人称讲主角(${lg === "ja" ? "「彼女は…」" : "「그녀는…」"}这类句子整段作废),需要指代主角时用${lg === "ja" ? "「あなた」" : "「당신/너」"}或直接省略主语。从设定时间点前几分钟开始,约 ${sp.story.want},停在「你必须立刻做选择」的节骨眼,不展开后续。` +
        `开场要让玩家与至少 2 位攻略对象${t.names[0]}/${t.names[1]}自然相遇(按名字写,两人必须真人出场且有台词)。\n` +
        (roleLines ? `出场角色身份(严禁写错身份:面试官别写成同批竞争者、店员别写成同事;下方身份描述是中文元信息,仅供你理解角色定位,正文严禁出现任何中文):\n${roleLines}\n` : "") +
        (playerName ? `主角名字是 ${playerName}:只允许出现在别人对主角的称呼里,叙述句里不要反复直呼。\n` : "") +
        `短句为主,对话自然,营造心动感的画面细节。\n` +
        `【以上所有中文(写作要求、角色身份、设定说明)都只是给你理解用的,一个字都不许写进正文;正文每一个字都必须是${sp.label}。】`;
    const BAN = lg === "en"
        ? `\n!!!硬性禁止(违反即整段作废):①正文严禁出现任何选项行——不得写 "1." "2." 这类编号;②严禁写任何一个选择的后果或选择之后的剧情,也不准交代"你已经做出决定"——必须在悬念处戛然而止;③总词数不得超过 460;④严禁方括号占位符(如 [Your Last Name]),姓氏/称呼必须写实或直接省略;⑤严禁第三人称叙述主角,叙述句主语只能是 you。`
        : `\n!!!硬性禁止(违反即整段作废):①正文严禁出现任何选项行——不得写 "1." "2." 这类编号;②严禁写任何一个选择的后果或选择之后的剧情,也不准交代"你已经做出决定"——必须在悬念处戛然而止;③总字数不得超过 ${sp.story.hi};④严禁方括号占位符;⑤严禁第三人称叙述主角;⑥严禁出现任何中文句子或简体中文专有字。`;
    let story = "";
    for (let round = 0; round < 3; round++) {
        story = await genCleanBlock(t, round ? "fs重写" : "fs", (warn) => askText(sp.sysText,
            base + SPEC + (round ? BAN + `重写一个全新的开场,不要沿用上一版措辞。` : "") + warn, 9000));
        let w = sp.len(story);
        // 只偏短时补写:严格限定"同一时刻"的细节,禁止顺势推进剧情(旧版补写会写到选择之后,是本管线最大坑)
        if (w < sp.story.lo) {
            console.log("  fs " + w + " " + sp.unit + "不足,补写同刻细节…");
            const add = await askText(sp.sysText,
                base + `下面这份开场草稿还不够长(才 ${w} ${sp.unit})。请只补写约 ${Math.round((sp.story.hi - w) / 2)} ${sp.unit},接在草稿最后一句话之后(不要重复已有内容)。` +
                `补写内容必须是【同一时刻】的更多环境细节或在场角色的更多对话——严禁推进剧情、严禁写出任何选择的后果、严禁出现 "1." "2." 编号选项行。` +
                `补完总长应落在 ${sp.story.fix}。\n草稿原文:\n${story}\n输出格式:仅围栏包裹的续段内容。`, 9000);
            story = story + "\n\n" + add; w = sp.len(story);
        }
        const bad = w < sp.story.lo || w > sp.story.hi || storyOvershoot(story);
        if (!bad) break;
        console.log(`  fs 第 ${round + 1} 版不合格(${w} ${sp.unit},越界=${storyOvershoot(story)}),整段重写…`);
        if (round === 2) console.log("  ⚠ fs 三次仍不合格,按现状继续(需人工复核)");
    }
    // 围栏残渣:模型偶尔在正文首尾留下 >> / << 单侧标记(stripFences 只处理成对围栏)
    story = story.replace(/^[\s<>:]+/, "").replace(/[\s<>:]+$/, "");
    // options:带 love 标签(结算)+ target(作用对象),开场须 ≥2 正向(flirt/kind);模型偶尔漏 love 字段 → 渐进警告重问
    let options = [];
    const posN = (arr) => arr.filter((o) => o.love === "flirt" || o.love === "kind").length;
    // 选项文字若点名了某攻略对象,该名字必须就是 target(防"文字写 Chloe、target 填 Ava"式错配)
    const optBad = (arr) => arr.some((o) => {
        const ns = t.names.filter((n) => nameHit(o.text || "", n, lg));
        return ns.length > 0 && !ns.includes(o.target);
    });
    const optText = lg === "en" ? "英文行动 4-10 词(具体行动,非是/否,you 视角)" : `${sp.label}行动 6-18 ${sp.unit}(具体行动,非是/否,主角视角)`;
    const optPrompt = (warn, extra) => `开场故事节选:\n${story.slice(0, 2400)}\n` +
        `为这个开场设计 4 个可行动选项。每条一个 JSON 对象 {"text":"${optText}","love":"${LOVE_TAGS.join("/")} 之一","target":"该选项主要影响的对象:必须来自名单 ${t.names.join("/")} 之一"}\n` +
        `love 分布要求:至少 2 条正向(flirt 或 kind),1 条 tease/neutral,1 条由你按剧情定;target 优先给开场故事里已出场的角色(建议 ${t.names[0]}/${t.names[1]} 各 1-2 条),最多 1 条给未出场角色。` +
        `love 与 target 字段是必填的,禁止省略、禁止拼写错误、禁止使用名单外的 target。\n` +
        `输出单行 JSON:{"options":[…]} (text 必须 100% 纯${sp.label})` + warn + (extra || "");
    for (let i = 0; i < 5 && (options.length < 4 || posN(options) < 2 || optBad(options)); i++) {
        const extra = i === 0 ? "" : "\n!!!上一轮不合格(选项不足 4 条、或正向 flirt/kind 不足 2 条、或 love/target 字段缺失、或选项文字点名的角色与 target 不一致)。请重新输出完整的 4 条,每条的 love 必须显式给出且 target 必须在名单内,文字里点到谁的名字 target 就必须是谁!!!";
        const raw = await askText(sp.sysText, base + optPrompt(i >= 2 ? sp.warn : "", extra), 2500);
        const m = raw.match(/\{[\s\S]*\}/);
        try {
            const obj = JSON.parse((m ? m[0] : raw).replace(CTRL, ""));
            const arr = Array.isArray(obj) ? obj : (Array.isArray(obj?.options) ? obj.options : null);
            if (arr) {
                options = arr.map((o) => ({
                    text: String(o.text || "").trim(),
                    love: LOVE_TAGS.includes(o.love) ? o.love : "neutral",
                    target: t.names.includes(o.target) ? o.target : t.names[0]
                })).filter((o) => o.text && shortOk(lg, o.text));
            } else { options = []; }
        } catch (e) { console.log("  opts JSON 解析失败,重问…(" + String(e).slice(0, 60) + ")"); options = []; }
        console.log("  opts " + options.length + " 条(正向 " + posN(options) + ")" + (options.length < 4 || posN(options) < 2 || optBad(options) ? ",重问…" : ""));
    }
    return { story, options: options.slice(0, 4) };
}

// ---- QC:硬校验(含恋爱卡新规) ----
function qcCard(card, t) {
    const errs = [];
    const s = card.structured || {};
    const sp = S(t), lg = LANG_OF(t);
    if (!card.title || card.title.length < 2) errs.push("title 无效");
    if (!card.title_zh || card.title_zh.length < 2) errs.push("title_zh 无效");
    if (!BANDS.includes(card.band)) errs.push("band 无效");
    if (card.love_mode !== true) errs.push("love_mode 缺失");
    if (card.gender_target !== t.target) errs.push("gender_target 应为 " + t.target);
    if (!card.text || sp.len(card.text) < sp.textMin) errs.push(`text ${sp.unit}数不足(<${sp.textMin}): ` + sp.len(card.text));
    if (s.band !== card.band) errs.push("structured.band 不一致");
    if (!s.world || !String(s.world.summary || "").trim()) errs.push("world.summary 缺失");
    if (!s.identity || !String(s.identity.name || "").trim()) errs.push("identity.name 缺失");
    const npcs = s.npcs || [];
    if (!Array.isArray(npcs) || npcs.length !== 5) errs.push("npcs 必须恰好 5 个,实得 " + npcs.length);
    if (npcs.map((n) => n && n.name).join(",") !== t.names.join(",")) errs.push("npcs 名字应为 " + t.names.join("/") + ",实得 " + npcs.map((n) => n && n.name).join("/"));
    const wantG = t.target === "female" ? "男" : "女";
    if (npcs.some((n) => n && n.gender !== wantG)) errs.push("npcs gender 须全为" + wantG + "(与 gender_target 互补)");
    if (s.identity && ((s.identity.gender || "") !== t.identity.gender)) errs.push("玩家性别应为 " + t.identity.gender);
    // 玩家名与攻略对象重名会让开场"Hi, X!"同时指玩家与 NPC(p3-05 实错,2026-09-12 加)
    if (s.identity && t.names.some((n) => String(n).toLowerCase() === String(s.identity.name || "").trim().toLowerCase())) errs.push("identity.name 与攻略对象重名: " + s.identity.name);
    const lr = s.love_rules;
    if (!lr || typeof lr !== "object") errs.push("love_rules 缺失");
    else {
        if (!(lr.affection && typeof lr.affection === "object")) errs.push("love_rules.affection 缺失");
        if (Number(lr.lock_at) < 60) errs.push("lock_at 异常");
    }
    if (!s.first_scene || sp.len(s.first_scene.story) < Math.round(sp.story.lo * 0.9)) errs.push(`first_scene.story ${sp.unit}数不足(<${Math.round(sp.story.lo * 0.9)})`);
    const opts = s.first_scene?.options || [];
    if (!Array.isArray(opts) || opts.length < 3) errs.push("options 不足 3");
    else {
        const bad = opts.filter((o) => !(o && String(o.text || "").trim()));
        if (bad.length) errs.push(bad.length + " 个选项无 text");
        const badLove = opts.filter((o) => !LOVE_TAGS.includes(o.love));
        if (badLove.length) errs.push("选项 love 标签非法: " + JSON.stringify(badLove.map((o) => o.love)));
        const badTgt = opts.filter((o) => !t.names.includes(o.target));
        if (badTgt.length) errs.push("选项 target 越界: " + JSON.stringify(badTgt.map((o) => o.target)));
        const posN = opts.filter((o) => o.love === "flirt" || o.love === "kind").length;
        if (posN < 1) errs.push("选项须至少 1 个正向(flirt/kind)");
    }
    const all = card.text + " " + (s.first_scene?.story || "");
    if (lg === "en") {
        const cjk = cjkCount(all);
        if (cjk > 5) errs.push("正文混入中文 " + cjk + " 字");
    } else {
        const why = sp.impure(all);
        if (why) errs.push("正文语种不纯: " + why);
        // 逐字段复查:长文走整段语种判定,短字段走短句判定(避免某字段整段是中文却被长文稀释)
        const longs = [["world.summary", s.world?.summary], ["world.rules", s.world?.rules],
            ["identity.background", s.identity?.background],
            ...(s.npcs || []).map((n, i) => [`npcs[${i}].personality`, n && n.personality])];
        for (const [k, v] of longs) {
            const w = fieldWhy(lg, sp, v);
            if (w) errs.push(`${k} 语种不纯(${w})`);
        }
        const shorts = [["title", card.title], ...(s.first_scene?.options || []).map((o, i) => [`options[${i}]`, o && o.text])];
        for (const [k, v] of shorts) {
            const t = String(v || "").trim();
            if (t && !shortOk(lg, t)) errs.push(`${k} 不是纯${sp.label}: ${t.slice(0, 40)}`);
        }
        for (const w of (Array.isArray(s.world?.vocab) ? s.world.vocab : [])) {
            if (String(w || "").trim() && !shortOk(lg, String(w))) errs.push("world.vocab 非目标语词形: " + w);
        }
    }
    return errs;
}

async function genOne(t) {
    assertLangSupported(t);
    const chars = [];
    console.log(`[${t.slug}] T1 标题…`);
    const meta = await genTitle(t);
    console.log(`[${t.slug}] T2 人设卡 5/5…`);
    for (let i = 0; i < t.names.length; i++) {
        const c = await genCharCard(t, t.names[i], t.archetypes[t.names[i]]);
        chars.push(c);
        console.log("  char " + (i + 1) + "/5 " + c.name + " (age " + c.age + ")");
    }
    const text = await genText(t, meta.title, chars);
    console.log(`[${t.slug}] text 合计 ` + S(t).len(text) + " " + S(t).unit);
    console.log(`[${t.slug}] T3 世界元+心动场景…`);
    const meta2 = await genWorldMeta(t, meta.title, text.slice(0, 700));
    const head = text.slice(0, 900) + "\n…\n" + text.slice(-600);
    console.log(`[${t.slug}] T4 主角…`);
    const ident = await genIdentity(t, meta.title, head);
    const npcs = chars.map((c) => ({
        name: c.name, gender: c.gender, age: Number(c.age) || null,
        // npcs[].personality 属于设定正文 → 日/韩卡写目标语(en 卡沿旧:中文元信息)
        role: c.role_zh, personality: LANG_OF(t) === "en" ? c.personality_zh : c.personality_t,
        relationship: c.relationship_zh,
        appearance: c.appearance_en, profile: {
            personality: c.personality_t, hobby: c.hobby_t, redline: c.redline_t,
            soft: c.soft_t, speech: c.speech_t
        }
    }));
    console.log(`[${t.slug}] T5 开场…`);
    const fs1 = await genFirstScene(t, meta.title, text, chars, ident.name || "");

    const structured = {
        band: t.band,
        theme: "minimal",
        love_mode: true,
        world: meta2.world || {},
        identity: ident,
        npcs,
        timeline: { start: t.start, note: "恋爱攻略线,单次会话 15-25 分钟可通关一段完整攻略" },
        scene_style: { env_templates: [], option_style: "romantic daily choices" },
        love_rules: {
            slots: 3,
            lock_at: 70,
            he_end: { min_affection: 75, heartbeat_min: 1 },
            be_end: { min_affection: 30 },
            affection: {
                flirt: { favor: 1, affection: 6 }, kind: { favor: 4, affection: 1 },
                tease: { favor: 2, affection: 2 }, neutral: { favor: 1, affection: 0 },
                awkward: { favor: 0, affection: -2 }, rude: { favor: -4, affection: -3 },
                reject: { favor: -3, affection: -8 }
            }
        },
        scenes: { heartbeat: meta2.heartbeats || [] },
        first_scene: { story: fs1.story, options: fs1.options }
    };
    const card = {
        /* lang 由主题自带(缺省 en);日/韩原生卡在 TOPICS 里写 lang:"ja"/"ko" 并可覆写 genTitle/genText 等
           提示词——本产线的提示词仍是"中文设定→英文正文",日韩原生题材属 P1/P2,
           且母语质量未审前不上线(见 docs/prds/yuntu-ja-ko-launch-prd.md) */
        title: meta.title, title_zh: meta.title_zh, lang: LANG_OF(t), band: t.band,
        category: t.category, category_zh: t.category_zh, theme: "minimal",
        love_mode: true, gender_target: t.target,
        text, structured
    };
    const errs = qcCard(card, t);
    return { card, chars, errs };
}

const only = args.only ? String(args.only) : "";
const wanted = TOPICS.filter((t) => !only || t.slug === only || t.slug.startsWith(only));
if (!wanted.length) { console.error("无匹配主题: " + only); process.exit(1); }
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// --openings-only:只对已存在的卡重生成 first_scene(story+options),其余字段原样保留;
// 清掉陈旧 bilingual(由 prebake_first_scene.mjs 重新预制)。用于开场缺陷返修,避免整卡重产。
if ("openings-only" in args) {
    for (const t of wanted) {
        const f = path.join(OUT_DIR, t.slug + ".card.json");
        if (!fs.existsSync(f)) { console.log(`✗ ${t.slug}: 卡文件不存在,跳过`); continue; }
        const card = JSON.parse(fs.readFileSync(f, "utf8"));
        console.log(`[${t.slug}] 重生成开场(story+options)…`);
        const fs1 = await genFirstScene(t, card.title, card.text, card.structured.npcs || [], card.structured.identity?.name || "");
        const w = lenOf(t, fs1.story), sp = S(t);
        const bad = w < sp.story.lo || w > sp.story.hi || storyOvershoot(fs1.story) || fs1.options.length < 4;
        console.log(`${bad ? "✗" : "✓"} ${t.slug} 新开场 ${w} ${sp.unit} 越界=${storyOvershoot(fs1.story)} options ${fs1.options.length} 条` + (bad ? "(未写盘,请重跑)" : ""));
        if (bad) continue;
        card.structured.first_scene = { story: fs1.story, options: fs1.options };
        fs.writeFileSync(f, JSON.stringify(card, null, 2) + "\n", "utf8");
    }
    process.exit(0);
}
let okN = 0;
for (const t of wanted) {
    const f = path.join(OUT_DIR, t.slug + ".card.json");
    const charDir = path.join(OUT_DIR, t.slug + ".chars");
    try {
        const { card, chars, errs } = await genOne(t);
        if (errs.length) {
            console.log(`✗ ${t.slug} 质检失败:\n  - ` + errs.join("\n  - "));
            continue;
        }
        fs.mkdirSync(charDir, { recursive: true });
        for (let i = 0; i < chars.length; i++) {
            fs.writeFileSync(path.join(charDir, String(i + 1).padStart(2, "0") + "-" + chars[i].name + ".char.json"), JSON.stringify(chars[i], null, 2), "utf8");
        }
        fs.writeFileSync(f, JSON.stringify(card, null, 2), "utf8");
        console.log(`✓ ${t.slug} → ${f}(${(fs.statSync(f).size / 1024).toFixed(1)}KB) + 人设卡 ${charDir}`);
        okN++;
    } catch (e) {
        console.log(`✗ ${t.slug} 生成异常: ${e.message}`);
    }
}
console.log(`\n---- 完成: ${okN}/${wanted.length} 张质检过卡 ----`);
