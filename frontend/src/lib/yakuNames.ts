/**
 * riichienv-core accurate Yaku ID mapping.
 * Matches `riichienv_core::yaku::ID_*` constants.
 */

export const YAKU_NAMES_KO: Record<number, string> = {
  1: '멘젠쯔모', // ID_TSUMO
  2: '리치', // ID_RIICHI
  3: '창강', // ID_CHANKAN
  4: '영상개화', // ID_RINSHAN
  5: '해저로월', // ID_HAITEI
  6: '하저로어', // ID_HOUTEI
  7: '역패: 백', // ID_HAKU
  8: '역패: 발', // ID_HATSU
  9: '역패: 중', // ID_CHUN
  10: '자풍패', // ID_JIKAZE
  11: '장풍패', // ID_BAKAZE
  12: '탕야오', // ID_TANYAO
  13: '이페코', // ID_IPEIKO
  14: '핑후', // ID_PINFU
  15: '찬타', // ID_CHANTA
  16: '일기통관', // ID_ITTSU
  17: '삼색동순', // ID_SANSHOKU
  18: '더블 리치', // ID_DOUBLE_RIICHI
  19: '삼색동각', // ID_SANSHOKU_DOKO
  20: '삼감자', // ID_SANKANTSU
  21: '또이또이', // ID_TOITOI
  22: '삼암각', // ID_SANANKOU
  23: '소삼원', // ID_SHOSANGEN
  24: '혼노두', // ID_HONROUTO
  25: '치또이츠', // ID_CHITOITSU
  26: '준찬타', // ID_JUNCHAN
  27: '혼일색', // ID_HONITSU
  28: '양페코', // ID_RYANPEIKO
  29: '청일색', // ID_CHINITSU
  30: '일발', // ID_IPPATSU
  31: '도라', // ID_DORA
  32: '아카도라', // ID_AKADORA
  33: '우라도라', // ID_URADORA
  34: '북(기타)도라', // ID_NUKIDORA
  35: '천화', // ID_TENHO
  36: '지화', // ID_CHIHO
  37: '대삼원', // ID_DAISANGEN
  38: '사암각', // ID_SUANKO
  39: '자일색', // ID_TSUISO
  40: '녹일색', // ID_RYUISOU
  41: '청노두', // ID_CHINROUTO
  42: '국사무쌍', // ID_KOKUSHI
  43: '소사희', // ID_SHOUSUUSHI
  44: '사감자', // ID_SUKANTSU
  45: '구련보등', // ID_CHUUREN
  47: '순정구련보등', // ID_JUNSEI_CHUUREN
  48: '사암각 단기', // ID_SUANKO_TANKI
  49: '국사무쌍 13면', // ID_KOKUSHI_13
  50: '대사희', // ID_DAISUUSHI
}

export function getYakuName(id: number): string {
  return YAKU_NAMES_KO[id] ?? `역(ID:${id})`
}
