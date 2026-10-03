# ASSETS

Každý stažený nebo odvozený soubor má řádek: název, zdroj, licence. Modely, zvuky a většina textur se generují v kódu, takže tady nejsou.

| Soubor / složka | Zdroj | Licence / poznámka |
| --- | --- | --- |
| `reference/matterport/**` | 3D prohlídka Malostranského gymnázia, https://my.matterport.com/show/?m=yiD42eykUPx (půdorysy, panoramata, pohledy; staženo 2026-10-03) | majetek školy / autora skenu; použito jako reference a zdroj textur pro nekomerční školní projekt |
| `legacy/vendor/babylon.js` | Babylon.js 9.29.0 (stará hra) | Apache-2.0 |
| `public/textures/mp/beam-wood.png` | Matterport `reference/matterport/panoramas/podkrovi_tramy/b.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/courtyard-paving.png` | Matterport `reference/matterport/panoramas/dvur_boulder/down.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/door-wood.png` | Matterport `reference/matterport/panoramas/chodba_dvere_okna/a.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/floor-checker.png` | Matterport `reference/matterport/floorplans/floor4_druhe_patro.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/floor-gym-lines.png` | Matterport `reference/matterport/floorplans/floor2_vstupni_podlazi.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/floor-lino-green.png` | Matterport `reference/matterport/panoramas/ucebna_zelena/down.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/floor-lino-orange.png` | Matterport `reference/matterport/panoramas/ucebna_obklad/down.jpg` + barva z `reference/matterport/floorplans/floor3_prvni_patro.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/floor-lino-yellow.png` | Matterport `reference/matterport/panoramas/ucebna_obklad/down.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/floor-parquet-gym.png` | Matterport `reference/matterport/panoramas/telocvicna_parkety/down.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/locker-blue.png` | Matterport `reference/matterport/panoramas/satna_skrinky2/c.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/ph/ph-burnt.png` | Poly Haven https://polyhaven.com/a/burned_ground_01 (1K diffuse, cache `public/textures/ph/raw/`), tools/fetch-textures.ts | CC0 |
| `public/textures/ph/ph-concrete.png` | Poly Haven https://polyhaven.com/a/concrete_floor_02 (1K diffuse, cache `public/textures/ph/raw/`), tools/fetch-textures.ts | CC0 |
| `public/textures/ph/ph-metal.png` | Poly Haven https://polyhaven.com/a/metal_plate (1K diffuse, cache `public/textures/ph/raw/`), tools/fetch-textures.ts | CC0 |
| `public/textures/ph/ph-rubble.png` | Poly Haven https://polyhaven.com/a/rubble (1K diffuse, cache `public/textures/ph/raw/`), tools/fetch-textures.ts | CC0 |
| `public/textures/ph/ph-rust.png` | Poly Haven https://polyhaven.com/a/rust_coarse_01 (1K diffuse, cache `public/textures/ph/raw/`), tools/fetch-textures.ts | CC0 |
| `public/textures/mp/stair-tread.png` | Matterport `reference/matterport/panoramas/schodiste_zabradli/down.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/wall-plaster.png` | Matterport `reference/matterport/panoramas/chodba_dvere_okna/a.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/wall-wainscot-wood.png` | Matterport `reference/matterport/panoramas/telocvicna_obklad/b.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/mp/window-prague.png` | Matterport `reference/matterport/panoramas/terasa_vyhled/b.jpg`, tools/matterport-textures.ts | odvozeno z prohlídky školy (viz řádek reference/matterport); nekomerční školní projekt |
| `public/textures/ph/raw/*_diffuse_1k.jpg` | Poly Haven 1K diffuse originals (concrete_floor_02, rubble, burned_ground_01, metal_plate, rust_coarse_01) z `dl.polyhaven.org`, cache pro tools/fetch-textures.ts | CC0 |
| `public/textures/index.json` | seznam textur (id, soubor, px, rozměr v m, zdroj); generují tools/matterport-textures.ts a tools/fetch-textures.ts | – |
| `reference/matterport/panoramas_4k/terasa_vyhled/*` | 360° panoráma ze střešní terasy školy (Matterport, 4096²/stěna), zdroj skyboxu Prahy | stejné jako ostatní Matterport reference |
