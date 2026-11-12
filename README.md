# WriteForYou — مكتب الوكلاء

> المراحل: استلام → سماع المكالمة → كتابة الفورم → مراجعة → اعتماد (Claude) → تم. كل شغل له Job ID، وفي بحث بالرقم، وملف PDF بإجابات Yes/No، وإكسل في data/WriteForYou.xlsx.

موقع محلي (localhost) بترفع عليه المشاريع (ملفات صوت + سكرين شوتس + ملفات)، وبتشوف مكتب من فوق فيه الوكلاء وهما بيشتغلوا، ولوحة تحكم بتوضح كل وكيل بيعمل إيه. **التنفيذ الحقيقي بيعمله Claude من الشات** مش الموقع.

## التشغيل
1. لازم Node.js يكون متسطّب (nodejs.org).
2. دبل كليك على `start.bat`. الموقع بيفتح على http://localhost:3000
3. اقفل نافذة الـ cmd لإيقاف الموقع.
4. زرار «تجربة العرض» بيشغّل تمثيل للوكلاء من غير بيانات حقيقية.

## إزاي الشغل بيمشي
1. ترفع المشروع من الموقع، فيتحفظ في `jobs/<job-id>/`.
2. تقول لـ Claude في الشات: **«اشتغل على الجديد في WriteForYou»** (فولدر المشروع لازم يكون مربوط بالجلسة).
3. Claude بيقرا `jobs/` و`inbox/`، يفرّغ الصوت ويكتب ويجهّز الفورم، ويكتب النتايج في نفس الفولدر. الموقع بيقراها كل ثانيتين.
4. ملي الفورم على المواقع الخارجية بيتم من المتصفح بموافقتك، والإرسال النهائي (submit) مابيحصلش من غير موافقتك.

## عقد الملفات (للي هيعالج الشغل: Claude)
```
jobs/<job-id>/
  job.json        { id, name, notes, createdAt, stage, status }   (الموقع بيكتبه)
  files/          الملفات المرفوعة                               (الموقع بيكتبها)
  status.json     Claude بيكتبه: { stage, status, agent, task, progress, updatedAt }
  log.jsonl       سطر JSON لكل خطوة: { ts, agent, level, msg }
  transcript.txt  النص المفرّغ من الصوت
  answers.json    الإجابات المستخرجة { "السؤال": "الإجابة" } أو مصفوفة
  form-plan.md    خطة تعبئة الفورم + السكرين شوتس المطلوبة
inbox/
  orders.jsonl    أوامر المدير: { id, ts, text, jobId }          (الموقع بيكتبه)
  handled.jsonl   ردود Claude: { id, ts, reply }                  (Claude بيكتبه)
```
- `stage`: received | listening | writing | forms | review | done
- `status`: queued | working | waiting_approval | done | error
- `agent`: intake | listener | writer | former | reviewer
- كل ما تكتب `status.json` أو تضيف سطر في `log.jsonl`، المكتب بيتحرك والوكيل بيظهر شغال.
