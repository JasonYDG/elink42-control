"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,".."),XLSX=require(path.join(root,"vendor/xlsx.full.min.js"));
const {T,I}=vm.runInNewContext(["planner.js","course-table.js","course-import.js"].map(name=>fs.readFileSync(path.join(root,name),"utf8")).join("\n")+";({T:CourseTable,I:CourseImport})",{Date});
const read=()=>XLSX.read(fs.readFileSync(path.join(root,"timetable-template.xlsx")),{type:"buffer"}),plain=x=>JSON.parse(JSON.stringify(x));
test("real downloadable XLSX uses typed times/dates and feeds the course renderer",()=>{
  assert.equal(XLSX.version,"0.20.3");
  assert.equal(require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(root,"planner.js"))).digest("hex"),"5103de4f25a932bc32e9999e8f9fdcde8bb16698acf735104bb24739c4404d39");
  const book=read(),data=I.parse(book,XLSX);
  assert.equal(book.Sheets["课程"].A2.t,"n");assert.equal(book.Sheets["考试"].A2.t,"n");
  assert.equal(data.classCount,35);assert.equal(data.examCount,2);assert.equal(data.exams[0].date,"2026-11-12");
  assert.equal(data.exams[0].start,"09:00");assert.equal(data.exams[1].end,"15:30");
  const model=T.weekModel(data.courses,T.dateValue("2026-11-12"),data.exams,data.examDays);
  assert.equal(model.classCount,28);assert.equal(model.examCount,2);assert.equal(model.rows.length,7);
  assert.equal(model.examColumns[3][1].subject,"数学");
  const mac=read();mac.Workbook.WBProps.date1904=true;
  mac.Sheets["考试"].A2.v-=1462;mac.Sheets["考试"].A3.v-=1462;
  assert.equal(I.parse(mac,XLSX).exams[0].date,"2026-11-12");
});
test("import preserves weekends and other exams, updates duplicate exams without duplicating",()=>{
  const courses=Array(7).fill("");courses[0]="08:00 周末阅读";courses[6]="09:00 美术";
  const exams=[{date:"2026-12-01",start:"09:00",end:"10:00",subject:"英语"}];
  const original=JSON.stringify({courses,exams}),incoming=I.parse(read(),XLSX);
  const next=I.merge(courses,exams,{},incoming),again=I.merge(next.courses,next.exams,next.examDays,incoming);
  assert.equal(next.courses[0],courses[0]);assert.equal(next.courses[6],courses[6]);assert.equal(next.exams.length,3);
  assert.equal(again.exams.length,3);assert.equal(JSON.stringify({courses,exams}),original);
  const examOnly=read();delete examOnly.Sheets["课程"];
  assert.deepEqual(plain(I.merge(courses,exams,{},I.parse(examOnly,XLSX)).courses),courses);
});
test("bad workbook inputs fail before mutating any course or exam data",()=>{
  for(const [mutate,message] of [
    [book=>book.Sheets["课程"].C2={t:"n",v:2,f:"1+1"},/公式/],
    [book=>book.Sheets["课程"].A1.v="时间",/第1列/],
    [book=>book.Sheets["课程"].A2.v=25/24,/时间/],
    [book=>book.Sheets["考试"].A2={t:"s",v:"2026-02-30"},/有效日期/],
    [book=>book.Sheets["考试"].E3.v="上午停课",/不一致/],
    [book=>book.Sheets["课程"]["!ref"]="A1:G102",/最多100/]
  ]) {const book=read();mutate(book);assert.throws(()=>I.parse(book,XLSX),message);}
});
