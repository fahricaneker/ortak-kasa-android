# Ortak Kasa Android

İki ortak için sade gelir-gider, avans, iş ve araç/servis takip uygulaması. Android APK, Capacitor ile üretilir; veriler Firebase Authentication ve Cloud Firestore üzerinde tutulur.

## Özellikler

- Gün, hafta, ay ve yıl filtresi
- Gelir ve gider kayıtları
- İki ortak için parça parça avans takibi
- Müşteri ve ödeme durumuyla iş takibi
- Ödenmeyen işlerin otomatik olarak bugüne devretmesi
- Ödenen işin ödeme tarihinde tamamlanıp aynı güne gelir yazılması
- Kullanılan araç ve servis/araç payı takibi
- 6 haneli kodla ikinci telefonu aynı ortaklığa bağlama
- Gerçek zamanlı iki telefon senkronizasyonu

## Firebase kurulumu

1. Firebase Console'da yeni proje oluşturun.
2. Authentication > Sign-in method bölümünde Email/Password yöntemini etkinleştirin.
3. Firestore Database'i Production mode ile oluşturun.
4. Project settings > Your apps bölümünden bir Web app ekleyip verilen yapılandırma değerlerini `.env` dosyasına yazın. Örnek alanlar `.env.example` dosyasındadır.
5. `firestore.rules` ve `firestore.indexes.json` dosyalarını Firebase CLI ile yayınlayın:

```bash
npx firebase-tools login
npx firebase-tools use FIREBASE_PROJE_KIMLIGI
npx firebase-tools deploy --only firestore
```

## Yerel geliştirme

```bash
npm install
cp .env.example .env
npm run dev
```

## Android APK

GitHub deposunda Actions > Android APK oluştur > Run workflow seçildiğinde test APK'sı hazırlanır. Firebase değerleri GitHub deposunda Settings > Secrets and variables > Actions > Variables bölümüne `.env.example` ile aynı adlarda eklenmelidir. İşlem bitince APK, workflow sayfasındaki Artifacts bölümünde `Ortak-Kasa-Android` adıyla görünür.

İlk testler debug APK ile yapılır. Düzenli güncelleme dağıtımı veya Google Play yayını öncesinde kalıcı bir release imzalama anahtarı eklenmelidir.
