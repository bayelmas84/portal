-- 043_member_capacity.sql
-- Sprint kapasite planlama: her ekip üyesinin bir sprint için ne kadar
-- story point'e "sığabileceğini" (kapasitesini) tutar. Proje bazında
-- saklanır (sprint'ten bağımsız — her yeni sprint için varsayılan olarak
-- aynı kapasite kullanılır, üyeler izin/tatil gibi durumlarda bu değeri
-- güncelleyebilir). Varsayılan 10 SP, standart 2 haftalık bir sprint için
-- makul bir başlangıç noktası olarak seçildi.
CREATE TABLE IF NOT EXISTS project_member_capacity (
  project_k TEXT NOT NULL,
  username TEXT NOT NULL,
  capacity_points NUMERIC NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_k, username)
);
