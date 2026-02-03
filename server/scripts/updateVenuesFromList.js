import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Venue from '../models/Venue.js';

dotenv.config();

const raw = [
  { name: '가나아트', openHours: '평일 10:00 - 19:00', website: '[링크](www.galleryinsaart.com/)', wheelchair: 'N', parking: 'N / N', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 37.57499572, lng: 126.983939 },
  { name: '경기도박물관', openHours: '10:00 - 18:00 (입장마감 17:20)', website: '[링크](musenet.ggcf.kr/)', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.26818786, lng: 127.108653 },
  { name: '경기문화재단', openHours: '09:00 - 18:00', website: '정보없음', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'N', brailleAudio: 'N / Y', lat: 37.26677627, lng: 126.985018 },
  { name: '광주시립미술관', openHours: '평일, 주말, 공휴일 : 10:00 ~ 18:00 매월 마지막 주 수요일 : 10:00 ~20:00 (문화가 있는 날)', website: '[링크](artmuse.gwangju.go.kr/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / Y', lat: 35.18323305, lng: 126.885736 },
  { name: '광주역사민속박물관', openHours: '오전 09:00 ~ 오후 18:00 관람 종료 30분 전까지 입장 가능', website: '[링크](www.gwangju.go.kr/gjhfm/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / Y', lat: 35.18441617, lng: 126.888436 },
  { name: '국립경주박물관', openHours: '관람시간: 10:00~18:00 (토요일 및 공휴일 1시간 연장) 야간연장개관: 10:00~21:00 (매달 마지막 주 수요일, 3월~12월 매주 토요일) 입장마감: 관람 종료 30분전 까지', website: '[링크](gyeongju.museum.go.kr/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 35.82943009, lng: 129.228682 },
  { name: '국립고궁박물관', openHours: '10:00~18:00 (수·토요일은 10:00~21:00) 입장은 마감 1시간 전까지', website: '[링크](www.gogung.go.kr)', wheelchair: 'Y', parking: 'N / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.57659162, lng: 126.974975 },
  { name: '국립광주박물관', openHours: '10:00~18:00  야간개장 10:00~20:00 (4월~10월)매주 토요일  어린이박물관 10:00~17:00  박물관 정원은 항상 열려 있습니다.(08:00-20:00)', website: '[링크](gwangju.museum.go.kr/index.jsp)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 35.18965658, lng: 126.883951 },
  { name: '국립김해박물관', openHours: '상설전시 9:00~18:00 어린이박물관10:00~17:50 (준비시간: 12:00~13:00 미운영) 입장 시간 관람 종료 30분 전까지', website: '[링크](gimhae.museum.go.kr/kr/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 35.24353009, lng: 128.872585 },
  { name: '국립대구박물관', openHours: '평일 09:00 - 18:00 (코로나19 상황으로 18:00 까지 관람 가능)토요일 09:00 - 18:00 (코로나19 상황으로 18:00 까지 관람 가능)일요일 09:00 - 18:00 (코로나19 상황으로 18:00 까지 관람 가능)공휴일 09:00 - 18:00 (1월 1일, 설날, 추석 당일 휴관)월요일 휴무 (월요일이 공휴일인 경우 다음 평일 휴관)', website: '[링크](daegu.museum.go.kr/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 35.84557453, lng: 128.638342 },
  { name: '국립민속박물관', openHours: '매일 10:00 - 18:00', website: '[링크](www.nfm.go.kr/home/subIndex/1241.do)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.78666956, lng: 126.693918 },
  { name: '국립부여박물관', openHours: '관람시간 : 오전 9시 ~ 오후 6시 문화가 있는 날이 있는 주의 토요일 : 오전 9시 ~ 오후 9시 문화가 있는 날 관련 야간 개장 일자는 공지사항에서 확인하실 수 있습니다. 관람 종료시간 30분 전까지만 입장할 수 있습니다.', website: '[링크](buyeo.museum.go.kr/contents/siteMain.do)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 36.27564277, lng: 126.917893 },
  { name: '국립아시아문화전당홍보관', openHours: '내부시설 : 10:00 ~ 18:00 라이브러리파크, 문화창조원 매주 수요일, 토요일 10:00 ~ 20:00까지 연장 운영 외부시설 (03월 - 11월) 06:00 ~ 22:00 (12월 - 02월) 07:00 ~ 22:00', website: '[링크](www.acc.go.kr/main/index.do)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 35.1470573, lng: 126.920031 },
  { name: '미륵사지국립익산박물관', openHours: '09:00 ~ 18:00', website: '[링크](iksan.museum.go.kr/kor/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 36.01155117, lng: 127.028714 },
  { name: '국립전주박물관', openHours: '10:00 ~ 18:00 입장마감 17:30', website: '[링크](jeonju.museum.go.kr/)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 35.80103866, lng: 127.088374 },
  { name: '국립진주박물관', openHours: '09:00 ~ 18:00  입장마감 : 관람종료 30분전 까지', website: '[링크](jinju.museum.go.kr/kor/)', wheelchair: 'Y', parking: 'N / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 35.18901371, lng: 128.076844 },
  { name: '국립춘천박물관', openHours: '09:00 ~ 18:00  관람종료 30분 전까지 입장가능', website: '[링크](chuncheon.museum.go.kr/kor/index.do)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.86384113, lng: 127.752088 },
  { name: '국립현대미술관', openHours: '정보없음', website: '[링크](www.mmca.go.kr/)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 37.71373368, lng: 126.858773 },
  { name: '금천구청금나래아트홀', openHours: '매일 09:00 ~ 19:00', website: '[링크](gcfac.or.kr/mpage)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.45706565, lng: 126.896037 },
  { name: '대전근현대사전시관', openHours: '화-일 10:00 - 18:00', website: '[링크](www.daejeon.go.kr/upp/UppContentsHtmlView.do?menuSeq=4824)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 36.32670622, lng: 127.420924 },
  { name: '대전시립미술관', openHours: '03월 ~ 10월 : 10:00 ~ 19:00 (매월 마지막 수요일 21:00 까지) 11월 ~ 02월 : 10:00 ~ 18:00 (매월 마지막 수요일 21:00 까지) 관람시간 종료 30분전까지(단, 특별전은 관람시간 종료 1시간전까지)', website: '[링크](www.daejeon.go.kr/dma/index.do)', wheelchair: 'Y', parking: 'Y / Y', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 36.36704787, lng: 127.385726 },
  { name: '동대문디자인플라자', openHours: '여는시간 10:00 닫는시간 20:00', website: '[링크](ddp.or.kr)', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.56804459, lng: 127.01089 },
  { name: '드영미술관', openHours: '10:00 - 17:00', website: '[링크](www.deyoungmuseum.co.kr/)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 35.13429786, lng: 126.953481 },
  { name: '제8대유엔사무총장반기문평화기념관', openHours: '화-일 09:00 - 18:00', website: '[링크](www.eumseong.go.kr/Banki-moonpeacemuseum/index.do)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 36.89195764, lng: 127.664407 },
  { name: '강원도농산물원종장동산별관', openHours: '정보없음', website: '정보없음', wheelchair: 'N', parking: 'N / N', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 37.74071322, lng: 127.796989 },
  { name: '상주박물관', openHours: '오전 9:30 - 오후 5:30 까지', website: '[링크](www.sangju.go.kr/museum/main.tc)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 36.45785989, lng: 128.241558 },
  { name: '서대문형무소역사관', openHours: '여름철(3월~10월): 09:30~18:00 겨울철(11월~2월): 09:30~17:00 입장 마감은 관람 종료 30분 전 주말 및 공휴일 사전예약 필수', website: '[링크](sphh.sscmc.or.kr/)', wheelchair: 'N', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.57460851, lng: 126.955612 },
  { name: '서울공예박물관', openHours: '전시실  10:00~18:00  아카이브실, 보이는수장고, 보존과학실은 평일(화~금)에만 운영됩니다.  야외공간 안전사고 예방을 위해 야간 시간대의 공예마당 출입을 제한합니다 (출입제한시간: 22:00~다음날08:00) 위 시간에는 보안등을 제외한 모든 경관등을 소등합니다. 박물관 입장마감: 17:30', website: '[링크](craftmuseum.seoul.go.kr/main)', wheelchair: 'Y', parking: 'N / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.57664817, lng: 126.983533 },
  { name: '서울시립미술관', openHours: '평일(화~금) 오전 10시~오후 8시 토,일,공휴일 하절기(3~10월) 오전 10시~오후 7시 동절기(11~2월) 오전 10시~오후 6시 문화가 있는 날 운영 마지막 수요일 오전 10시~오후 10시 관람 종료 1시간 전까지 입장', website: '[링크](sema.seoul.go.kr/)', wheelchair: 'N', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.56410607, lng: 126.973699 },
  { name: '서울역사박물관', openHours: '9:00 ~ 18:00 (입장마감 : 17:30)', website: '[링크](museum.seoul.go.kr/www/NR_index.do?sso=ok)', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.57049685, lng: 126.971075 },
  { name: '서호미술관', openHours: '10:00 - 18:00', website: '[링크](www.seohoart.com/)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'N', brailleAudio: 'N / Y', lat: 37.63270861, lng: 127.35151 },
  { name: '세종문화회관', openHours: '정보없음', website: '[링크](www.sejongpac.or.kr/portal/main/main.do)', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.57184786, lng: 126.976168 },
  { name: '소촌아트팩토리', openHours: '매주 화~일요일 09:00 ~ 18:00 전시,공연,각종 행사시 운영시간 연장', website: '[링크](www.gwangsan.go.kr/sochon/)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 35.1526623, lng: 126.790882 },
  { name: '속초문화예술회관', openHours: '09:00 - 대관 및 전시에 따라 다름', website: '[링크](www.sokcho.go.kr/culture)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 38.21304612, lng: 128.588372 },
  { name: '실학박물관', openHours: '10:00~18:00 (입장마감 11월~2월 17:00 / 3월~10월 17:30)', website: '[링크](silhak.ggcf.kr/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / Y', lat: 37.51599953, lng: 127.300635 },
  { name: '예술의전당', openHours: '정보없음', website: '[링크](www.sac.or.kr/site/main/content/inchoonArtlHall)', wheelchair: 'Y', parking: 'Y / Y', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.4802402, lng: 127.014215 },
  { name: '예천박물관', openHours: '매일 09:00 - 18:00 (하절기, 3~10월) 매일 09:00 - 17:00 (동절기, 11~2월)', website: '[링크](ycg.kr/open.content/museum/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 36.7001577, lng: 128.514231 },
  { name: '용인시박물관', openHours: '화~일 09:00~18:00', website: '정보없음', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / Y', lat: 37.27389677, lng: 127.157125 },
  { name: '울산박물관', openHours: '09:00 ~ 18:00', website: '[링크](www.ulsan.go.kr/museum/)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 35.52713607, lng: 129.308692 },
  { name: '의림지역사박물관', openHours: '9:00~18:00(관람마감 30분전까지 매표가능)', website: '[링크](www.jecheon.go.kr/museum/index.do)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.17612981, lng: 128.209516 },
  { name: '전남도립미술관', openHours: '10:00 - 18:00', website: '[링크](artmuseum.jeonnam.go.kr/)', wheelchair: 'N', parking: 'N / N', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 34.9677499, lng: 127.588859 },
  { name: '전북도립미술관', openHours: '10:00 - 18:00', website: '[링크](www.jma.go.kr/)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 35.72770556, lng: 127.106924 },
  { name: '제주도립미술관', openHours: '관람시간: 오전 9시 ~ 오후 6시 7~9월 오전 9시~오후8시까지 운영 매표시간: 오전 9시부터 관람시간 종료 30분전까지', website: '[링크](www.jeju.go.kr/jmoa/index.htm)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 33.45255002, lng: 126.489686 },
  { name: '청계천박물관', openHours: '3월~10월, 11월~2월 평일09:00 ~18:00 토/일/공휴일09:00 ~ 18:00(관람시간 종료 30분전까지 입장하실 수 있습니다).', website: '[링크](museum.seoul.go.kr/cgcm/index.do)', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.57126617, lng: 127.035043 },
  { name: '청주시립대청호미술관', openHours: '3월 ~ 10월 10:00 - 18:00, 11월 ~2월 10:00 - 17:00', website: '[링크](cmoa.cheongju.go.kr/daecheongho/index.do)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 36.50711307, lng: 127.49372 },
  { name: '청화랑', openHours: '월-금 10:30 - 18:00 토 11:00 - 17:00', website: '정보없음', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 37.52273774, lng: 127.047651 },
  { name: '토포하우스', openHours: '정보없음', website: '[링크](www.topohaus.com/)', wheelchair: 'N', parking: 'N / Y', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 37.57409513, lng: 126.984325 },
  { name: '펄벅기념관', openHours: '매일 09:30 - 17:30', website: '[링크](www.bcmuseum.or.kr/index1.php#title_main)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.47555869, lng: 126.781706 },
  { name: '한국만화박물관', openHours: '10:00 ~ 18:00 (17:00까지 입장)', website: '[링크](www.komacon.kr/comicsmuseum)', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.50905498, lng: 126.745618 },
  { name: '한국민화뮤지엄', openHours: '09:30 - 17:30, 30분 전 입장 마감', website: '[링크](minhwamuseum.com/)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 34.50867534, lng: 126.804163 },
  { name: '한밭교육박물관', openHours: '평일 09:00 ~ 18:00 (입장시간 17:30까지)', website: '[링크](www.hbem.or.kr/kor.do)', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / Y', lat: 36.33739295, lng: 127.428797 },
  { name: '아트선재센터', openHours: '12:00 - 19:00 (월 휴무)', website: '정보없음', wheelchair: 'Y', parking: 'N / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 37.579, lng: 126.981 },
  { name: '대림미술관', openHours: '11:00 - 20:00 (월,화 휴무)', website: '정보없음', wheelchair: 'Y', parking: 'N / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.578, lng: 126.973 },
  { name: '그라운드시소 서촌', openHours: '10:00 - 19:00', website: '정보없음', wheelchair: 'N', parking: 'N / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 37.577, lng: 126.972 },
  { name: '리움미술관', openHours: '10:00 - 18:00 (월 휴무)', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.539, lng: 126.999 },
  { name: '아모레퍼시픽미술관', openHours: '10:00 - 18:00 (월 휴무)', website: '정보없음', wheelchair: 'Y', parking: 'Y / Y', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.528, lng: 126.968 },
  { name: '그라운드시소 성수', openHours: '10:00 - 19:00', website: '정보없음', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 37.546, lng: 127.065 },
  { name: '그라운드시소 센트럴', openHours: '10:30 - 19:00 (백화점 휴무)', website: '정보없음', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.564, lng: 126.981 },
  { name: '피크닉 (piknic)', openHours: '10:00 - 18:00 (월 휴무)', website: '정보없음', wheelchair: 'N', parking: 'N / Y', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 37.556, lng: 126.978 },
  { name: '송은 (SONGEUN)', openHours: '11:00 - 18:30 (일 휴무)', website: '정보없음', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 37.524, lng: 127.044 },
  { name: '뮤지엄 산 (원주)', openHours: '10:00 - 18:00 (월 휴무)', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.415, lng: 127.823 },
  { name: '본태박물관 (제주)', openHours: '10:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / Y', lat: 33.303, lng: 126.392 },
  { name: '백남준아트센터 (용인)', openHours: '10:00 - 18:00 (월 휴무)', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.269, lng: 127.110 },
  { name: '국립아시아문화전당', openHours: '10:00 - 18:00 (수,토 연장)', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 35.147, lng: 126.920 },
  { name: '국립중앙박물관', openHours: '10:00 - 18:00 (수,토 ~21:00)', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / Y', lat: 37.524, lng: 126.980 },
  { name: '예술의전당 (SAC)', openHours: '10:00 - 18:00 (시설별 상이)', website: '정보없음', wheelchair: 'Y', parking: 'Y / Y', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.483, lng: 127.014 },
  { name: '국립아시아문화전당 (ACC)', openHours: '10:00 - 18:00 (수,토 ~20:00)', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 35.147, lng: 126.920 },
  { name: '국립경주박물관', openHours: '10:00 - 18:00 (토,공 ~19:00)', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 35.829, lng: 129.228 },
  { name: '국립광주박물관', openHours: '10:00 - 18:00', website: '정보없음', wheelchair: 'N', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 35.189, lng: 126.883 },
  { name: '국립대구박물관', openHours: '09:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 35.845, lng: 128.638 },
  { name: '국립김해박물관', openHours: '09:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 35.243, lng: 128.872 },
  { name: '국립부여박물관', openHours: '09:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 36.275, lng: 126.917 },
  { name: '국립익산박물관', openHours: '09:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'N / N', lat: 36.011, lng: 127.028 },
  { name: '국립춘천박물관', openHours: '09:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.863, lng: 127.752 },
  { name: '국립청주박물관', openHours: '09:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 36.650, lng: 127.502 },
  { name: '대한민국역사박물관', openHours: '10:00 - 18:00 (수,토 ~21:00)', website: '정보없음', wheelchair: 'Y', parking: 'N / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.575, lng: 126.978 },
  { name: '국립한글박물관', openHours: '10:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 37.521, lng: 126.981 },
  { name: '한국영상자료원', openHours: '10:00 - 19:00 (시네마테크)', website: '정보없음', wheelchair: 'Y', parking: 'N / Y', accessibleToilet: 'Y', brailleAudio: 'Y / N', lat: 37.578, lng: 126.890 },
  { name: '한국예술종합학교', openHours: '(공연/전시별 상이)', website: '정보없음', wheelchair: 'N', parking: 'N / Y', accessibleToilet: 'N', brailleAudio: 'N / N', lat: 37.606, lng: 127.054 },
  { name: '태권도진흥재단 (원원)', openHours: '10:00 - 18:00', website: '정보없음', wheelchair: 'Y', parking: 'Y / N', accessibleToilet: 'Y', brailleAudio: 'Y / Y', lat: 35.938, lng: 127.818 }
];

function parseBoolPair(value) {
  const normalized = String(value || '').replace(/\s+/g, '');
  if (!normalized.includes('/')) {
    return { first: false, second: false };
  }
  const [a, b] = normalized.split('/');
  return { first: a.toUpperCase() === 'Y', second: b.toUpperCase() === 'Y' };
}

function normalizeWebsite(url) {
  if (!url || url === '링크' || url === '[정보없음]' || url === '정보없음') return '';
  const markdownMatch = String(url).match(/\(([^)]+)\)/);
  if (markdownMatch) return markdownMatch[1].trim();
  return url;
}

function toBool(value) {
  return String(value || '').trim().toUpperCase() === 'Y';
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  for (const item of raw) {
    const parking = parseBoolPair(item.parking);
    const brailleAudio = parseBoolPair(item.brailleAudio);
    const website = normalizeWebsite(item.website);
    const openHours = item.openHours && item.openHours !== '[정보없음]' ? item.openHours : '';
    const existing = await Venue.findOne({ name: item.name }).lean();
    const currentBarrier = existing?.barrierFree || {};

    const update = {
      name: item.name,
      address: item.address || existing?.address || '',
      location: { lat: Number(item.lat), lng: Number(item.lng) },
      barrierFree: {
        ...currentBarrier,
        wheelchair: toBool(item.wheelchair),
        elevator: typeof item.elevator === 'boolean' ? item.elevator : currentBarrier.elevator,
        braille: brailleAudio.first,
        audioGuide: brailleAudio.second,
        accessibleToilet: toBool(item.accessibleToilet),
        parkingFree: parking.first,
        parkingPaid: parking.second
      },
      updatedAt: new Date()
    };
    if (openHours) update.openHours = openHours;
    if (website) update.website = website;

    await Venue.findOneAndUpdate({ name: item.name }, { $set: update }, { upsert: true });
  }

  await mongoose.disconnect();
  console.log('Venue updates complete');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
