# התקנה

<div dir="rtl">

**כמעט הכול כבר מוכן ורץ.** נכנסתי בעצמי ל-Supabase ול-GitHub ועשיתי את כל
מה שניתן לעשות מרחוק:

- ✅ נפתח פרויקט Supabase (`househero`, אזור Frankfurt).
- ✅ הורצו שלושת סקריפטי ה-SQL — כל הטבלאות, ההרשאות (RLS), והפונקציות.
- ✅ שני ה-Edge Functions (`send-reminders`, `send-test`) הועלו.
- ✅ נבדק דוח אבטחה ותוקנו כל הממצאים הרלוונטיים.
- ✅ `src/config.ts` מחובר לפרויקט האמיתי, ונדחף ל-`main`.
- ✅ ה-repo הפך לציבורי, וניתנו הרשאות כתיבה ל-workflows (שני תיקונים
  שביקשתי ממך לעשות בעצמך, כי אין לזה API מרחוק — תודה).

**נשארו שני דברים, שניהם דורשים דפדפן עם החשבון האישי שלך ואין דרך לעשות
אותם מרחוק:**

1. **הדלקה חד-פעמית של GitHub Pages** (דקה אחת) — בלי זה האתר לא עולה בכלל.
2. **חיבור כניסה עם Google** (כ-10 דקות).

---

## שלב 1 — שני תיקוני הגדרות חד-פעמיים (חובה, שתי דקות)

זה מה שחוסם כרגע את העלייה לאוויר. שני התיקונים האלה חייבים להיעשות ידנית
דרך האתר — לא קיים API שמאפשר לי לבצע אותם מרחוק (מגבלות ידועות של
GitHub, לא קשורות למה שהגדרנו בקוד).

**א. הדלקת GitHub Pages**

1. נכנסים ל-<https://github.com/PinhasZiv/HouseHero/settings/pages>.
2. תחת **Build and deployment** ← **Source**, בוחרים **GitHub Actions**
   (במקום "Deploy from a branch").

**ב. קביעת main כברירת המחדל** ✅ בוצע.

**ג. הסרת הגבלת הענף מסביבת ה-Pages**

גם אחרי ששני התיקונים הקודמים בוצעו, ה-deploy עדיין נכשל באותה הודעה:
"Branch main is not allowed to deploy to github-pages due to environment
protection rules". הסיבה: לסביבת ה-`github-pages` יש הגבלת ענפים משלה
שנקבעה בנפרד (ל-`claude/househero-task-pwa-rqg8lh` הישן), וזה לא מתעדכן
לבד כששינינו את ברירת המחדל.

1. נכנסים ל-<https://github.com/PinhasZiv/HouseHero/settings/environments>.
2. לוחצים על **github-pages**.
3. תחת **Deployment branches and tags**, אם רשום שם ענף ספציפי — מוחקים
   אותו (עם ה-🗑) ומוסיפים במקומו **Add deployment branch or tag rule** ←
   בוחרים **Selected branches and tags** ← מקלידים `main` ← **Add rule**.
   (או פשוט משנים את הבורר ל-**No restriction**, שזו האפשרות הפשוטה
   ביותר ומספיקה לחלוטין לאפליקציה פרטית כמו זו.)
4. **Save protection rules** אם מופיע כפתור כזה.

זהו. אחרי שלושת אלה תגיד לי "עשיתי" ואני אריץ שוב את ה-deploy — מהריצה
הזו והלאה זה כבר יעבוד לבד בכל שינוי עתידי, בלי לחזור על השלבים האלה.

---

## שלב 2 — כניסה עם Google

### א. יצירת מזהה ב-Google Cloud

נכנסים ל-[console.cloud.google.com](https://console.cloud.google.com).

1. למעלה, בורר הפרויקטים ← **New Project** ← שם: `HouseHero` ← **Create**.
   לוודא שהפרויקט החדש הוא זה שנבחר בבורר.
2. בתפריט: **APIs & Services** ← **OAuth consent screen**.
   - **User Type: External** ← **Create**
   - App name: `HouseHero`
   - User support email: המייל שלך
   - Developer contact information: אותו מייל
   - **Save and Continue** בכל המסכים הבאים עד הסוף.
3. **APIs & Services** ← **Credentials** ← **Create credentials** ←
   **OAuth client ID**.
   - Application type: **Web application**
   - Name: `HouseHero`
   - תחת **Authorized redirect URIs** ← **ADD URI**, ומדביקים בדיוק את זה:

     ```
     https://axamojjnbhygnclqihhe.supabase.co/auth/v1/callback
     ```

     (זו כתובת ה-callback הקבועה של פרויקט ה-Supabase שכבר פתחתי לך —
     אין צורך לשנות בה כלום.)
   - **Create**. נפתח חלון עם **Client ID** ו-**Client secret** — משאירים
     אותו פתוח.

### ב. חיבור ל-Supabase

נכנסים ל-[supabase.com/dashboard/project/axamojjnbhygnclqihhe](https://supabase.com/dashboard/project/axamojjnbhygnclqihhe):

4. **Authentication** ← **Sign In / Providers** ← **Google**.
   - להדליק את **Enable Sign in with Google**
   - להדביק את **Client ID** ואת **Client Secret** מהחלון של Google
   - **Save**
5. **Authentication** ← **URL Configuration**:
   - **Site URL**: `https://<שם המשתמש שלך ב-GitHub>.github.io/HouseHero/`
   - **Redirect URLs** ← **Add URL**: אותה כתובת בדיוק.

> **הקו הנטוי בסוף הכתובת חשוב.** אם אחרי הכניסה עם Google מגיעים לדף לבן,
> כמעט תמיד זה בגלל אי-התאמה כאן.

### ג. פתיחה לכולם

6. חזרה ל-Google Cloud ← **OAuth consent screen** ← **Publish app** ←
   **Confirm**.

   כל עוד לא עשית את זה, רק חשבונות שרשומים ידנית תחת **Test users** יוכלו
   להיכנס, וכל השאר יראו אזהרה. אין צורך בשום בדיקה או אישור מגוגל —
   זו רק כניסה בסיסית.

---

## בדיקה בטלפון

1. לפתוח את הכתובת בכרום באנדרואיד:
   `https://<שם המשתמש שלך ב-GitHub>.github.io/HouseHero/`
2. **כניסה עם Google**.
3. תפריט הכרום (⋮) ← **הוספה למסך הבית**. **כדאי לעשות את זה עכשיו, לפני
   הפעלת ההתראות** — לאפליקציה מותקנת יש קבלת התראות אמינה יותר.
4. לפתוח את האפליקציה **מהאייקון החדש במסך הבית**, לא מהלשונית.
5. ליצור מרחב, להוסיף משימה ראשונה עם ניקוד ושעת תזכורת.
6. **עוד** (הלשונית האחרונה) ← **הפעלת תזכורות** ← לאשר את בקשת ההרשאה.
7. **שליחת התראת בדיקה**. אמורה להגיע תוך שניות.

## הזמנת בן/בת הזוג

לשונית **עוד** ← **שליחת הזמנה**. נפתחת חלונית השיתוף של אנדרואיד, אפשר
לשלוח בוואטסאפ. מי שמקבל: פותח את הקישור, נכנס עם Google, מקליד את הקוד בן
שש התווים, ומוסיף למסך הבית.

---

## אופציונלי: עדכונים עתידיים אוטומטיים

זה לא נדרש כדי שהאתר יעבוד עכשיו — הכול כבר רץ. אבל אם בעתיד תרצה שאני
(או כל שינוי עתידי בקוד) אעדכן את מסד הנתונים או את הפונקציות **בלי
שתצטרך לבקש ממני להריץ את זה ידנית שוב**, אפשר להוסיף ב-GitHub ←
**Settings** ← **Secrets and variables** ← **Actions**:

| Name | Secret |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | נוצר ב-[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) ← **Generate new token** |
| `SUPABASE_PROJECT_REF` | `axamojjnbhygnclqihhe` |
| `SUPABASE_DB_URL` | מ-Supabase ← כפתור **Connect** ← **Transaction pooler** (עם הסיסמה האמיתית של מסד הנתונים) |
| `VAPID_PRIVATE_KEY` | המפתח הפרטי של ההתראות — יש לי אותו, תבקש ואשלח שוב אם צריך |

בלי הסודות האלה, שינויים עתידיים ב-`supabase/migrations/` או
ב-`supabase/functions/` פשוט לא יעלו לבד — אבל אפשר תמיד לבקש ממני
להריץ אותם ידנית באותו אופן שעשיתי הפעם.

---

## אם משהו לא עובד

**אחרי הכניסה עם Google מגיעים לדף לבן, או "requested path is invalid".**
ה-**Site URL** וה-**Redirect URLs** ב-Supabase חייבים להיות זהים לחלוטין
לכתובת האתר, כולל הקו הנטוי בסוף. ובגוגל, כתובת ה-redirect היא זו של
Supabase (`.../auth/v1/callback`), לא של האפליקציה.

**גוגל מציגה "This app is blocked" או אזהרת אפליקציה לא מאומתת.**
לא עשית את שלב ג׳ למעלה — **Publish app**.

**"המכשיר הזה עדיין לא רשום" בהתראת הבדיקה.**
צריך קודם ללחוץ **הפעלת תזכורות** באותו מכשיר. כל מכשיר נרשם בנפרד.

**האפליקציה עדיין מציגה מסך "צריך להשלים הגדרה".**
בודקים בלשונית **Actions** בגיטהאב שריצת **Build and deploy** האחרונה על
`main` הסתיימה בירוק, ואז מרעננים.

**ריצת ה-workflow נכשלת ב-"Create Pages site failed: Resource not
accessible by integration".**
עוד לא בוצע שלב 1א למעלה — הדלקת GitHub Pages ב-Settings ← Pages ← Source
← GitHub Actions. זה חד-פעמי בלבד.

**ריצת ה-workflow נכשלת ב-"Branch main is not allowed to deploy to
github-pages due to environment protection rules".**
עוד לא בוצע שלב 1ג למעלה — הסרת הגבלת הענף בסביבת `github-pages` תחת
Settings ← Environments. גם זה חד-פעמי בלבד. (שינוי ברירת המחדל לבדו לא
מספיק — לסביבה יש הגבלה נפרדת משלה.)

</div>
