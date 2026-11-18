# ELINK 图片库

当前内置 118 张壁纸，所有图片使用主题名称显示。已移除 AAA、BBB 两张多图总览缩略图，内部图片 ID 不重新编号。

- 全屏：44 张，适配 400 × 300。[新增黄底全屏图](full-screen/yellow/)。
- 月份：12 张，按 1–12 月独立命名，如“1月 · 寒梅映雪”。[月份原图](calendar-wallpapers/yellow/)。
- 节气：24 张，每个节气各有一张独立生成的图片。[二十四节气](calendar-wallpapers/solar-terms/)。
- 节日：20 张，覆盖当前中国、新加坡、台湾日历中的节日名称；补班、补假不单独做图。[节日原图](calendar-wallpapers/holidays/)。
- 诗词与名句：12 张白底诗画。原有四幅及新增的登楼、梅花、望岳、秋鹤、瀑布、松月、春晓和江雪均在画中以马善政书体题写，作者题款用朱色。四色版有金黄，三色版以朱红呈现。[日历插画](calendar-wallpapers/verse/)
- 主题插画：保留 6 张原有日历图，按画面命名。[原有插画](calendar-wallpapers/originals/)。

在网页选择“日历壁纸”，再用分类选择月份、节气、节日或主题插画。点击缩略图载入预览，确认后保存到设备空位置，再在图片日历中选择该槽。网页不自动替换设备图片，也不自动按日期切换节日壁纸。

月份图只表示月度主题，不绑定两个节气；“清明”节气和“清明节”假期是两个独立条目。节气与节日图均为独立 ImageGen 输出，不复用月份图改名。年份、节气日期与各地假期仍由原日历数据处理，本轮未改动。

日历左图输出为 512 × 600，网页再生成设备使用的 256 × 300；略有比例差异的原图采用居中裁切，不拉伸。黄色用于四色屏，三色屏仍由现有处理器适配。

[本次精确提示词与原图哈希](generation-briefs-calendar.json) · [黄底月份和全屏图生成记录](generation-briefs-yellow.json)。原有素材权利归原作者；新生成原图保留完整字节。

诗文出处见[《侠客行》](https://zh.wikisource.org/wiki/俠客行_(李白))、[《定风波》](https://zh.wikisource.org/wiki/定風波_(蘇軾))、[《道德经》第六十四章](https://zh.wikisource.org/wiki/道德經精義)和[《行路难》](https://zh.wikisource.org/wiki/行路難_(李白))。

新增诗句见[《登鹳雀楼》](https://zh.wikisource.org/wiki/登鸛雀樓)、[《梅花》](https://zh.wikisource.org/wiki/梅花_(王安石))、[《望岳》](https://zh.wikisource.org/wiki/望岳)、[《秋词》](https://zh.wikisource.org/wiki/秋詞_(劉禹錫))、[《望庐山瀑布》](https://zh.wikisource.org/wiki/望廬山瀑布水二首)、[《山居秋暝》](https://zh.wikisource.org/wiki/山居秋暝)、[《春晓》](https://zh.wikisource.org/wiki/春曉)和[《江雪》](https://zh.wikisource.org/wiki/江雪)。[马善政书体与授权](https://github.com/google/fonts/tree/main/ofl/mashanzheng)
