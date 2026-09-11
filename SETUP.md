# התקנה

<div dir="rtl">

**כמעט הכול כבר מוכן ורץ.** נכנסתי בעצמי ל-Supabase ועשיתי את כל מה שניתן
לעשות מרחוק:

- ✅ נפתח פרויקט Supabase (`househero`, אזור Frankfurt).
- ✅ הורצו שלושת סקריפטי ה-SQL — כל הטבלאות, ההרשאות (RLS), והפונקציות.
- ✅ שני ה-Edge Functions (`send-reminders`, `send-test`) הועלו.
- ✅ נבדק דוח אבטחה ותוקנו כל הממצאים הרלוונטיים.
- ✅ `src/config.ts` מחובר לפרויקט האמיתי, ונדחף ל-`main`.
- ✅ ה-Build workflow כבר רץ על `main` — GitHub Pages נדלק אוטומטית.

**מה שנשאר לך לעשות — שלב אחד בלבד:** לחבר כניסה עם Google. זו הפעולה
היחידה שדורשת דפדפן עם החשבון האישי שלך, ואין דרך לעשות אותה מרחוק.

בערך 10 דקות.

---

## השלב היחיד — כניסה עם Google

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

</div>
