# Dự án: <checkin-su-kien> 
## Công nghệ - Chỉ dùng HTML, CSS, JavaScript thuần. Không dùng React/Vue, không có bước build. - Database và đăng nhập: Supabase, thư viện supabase-js v2 nạp qua CDN: 
https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 - Triển khai: Vercel dạng web tĩnh. 
## Quy tắc - Giao diện tiếng Việt, hiện đại, responsive (dùng tốt trên điện thoại). - Thông tin kết nối Supabase để trong file config.js (SUPABASE_URL, SUPABASE_KEY). - Chỉ dùng publishable/anon key ở frontend. KHÔNG dùng service_role/secret key. - Mọi bảng phải bật RLS và có policy rõ ràng. - Lệnh SQL tạo database viết vào thư mục database/ để tôi chạy trong Supabase SQL 
Editor. - Hiển thị thông báo lỗi dễ hiểu bằng tiếng Việt, không hiện lỗi kỹ thuật cho 
người dùng. - Làm từng bước. Sau mỗi bước tóm tắt ngắn: đã sửa file nào, tôi cần kiểm tra gì.