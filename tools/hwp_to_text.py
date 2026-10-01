# HWP5 본문 텍스트 추출기 (외부 패키지 없음). 사용: python tools/hwp_to_text.py sources_raw/05_...hwp > out.txt
# 이전 작업에서 등급판정기준 고시 텍스트 추출에 사용. 수형분석도의 연결 구조(도형 좌표)는 추출하지 않음.
import struct,zlib,sys
data=open(sys.argv[1],'rb').read()
ss=1<<struct.unpack_from('<H',data,0x1E)[0]; mss=1<<struct.unpack_from('<H',data,0x20)[0]
nfat,dir0=struct.unpack_from('<II',data,0x2C); cutoff,mf0,nmf,dif0,ndif=struct.unpack_from('<IIIII',data,0x38)
def sec(n): return data[512+n*ss:512+(n+1)*ss]
difat=list(struct.unpack_from('<109I',data,0x4C))
n=dif0
while n not in(0xFFFFFFFE,0xFFFFFFFF) and ndif:
    s=sec(n); v=struct.unpack('<%dI'%(ss//4),s); difat+=v[:-1]; n=v[-1]; ndif-=1
fat=[]
for f in difat[:nfat]: fat+=struct.unpack('<%dI'%(ss//4),sec(f))
def chain(n):
    out=b''
    while n<0xFFFFFFFA: out+=sec(n); n=fat[n]
    return out
dirs=chain(dir0)
ents=[]
for i in range(len(dirs)//128):
    e=dirs[i*128:(i+1)*128]; nl=struct.unpack_from('<H',e,0x40)[0]
    name=e[:max(nl-2,0)].decode('utf-16le'); typ=e[0x42]; st,sz=struct.unpack_from('<IQ',e,0x74)
    ents.append((name,typ,st,sz&0xffffffff))
root=ents[0]; ministream=chain(root[2])
mfat=[]
if nmf: 
    m=chain(mf0); mfat=list(struct.unpack('<%dI'%(len(m)//4),m))
def read(e):
    name,typ,st,sz=e
    if sz<cutoff:
        out=b'';n=st
        while n<0xFFFFFFFA: out+=ministream[n*mss:(n+1)*mss]; n=mfat[n]
        return out[:sz]
    return chain(st)[:sz]
E={e[0]:e for e in ents}
comp=read(E['FileHeader'])[36]&1
secs=sorted([e for e in ents if e[0].startswith('Section') and e[1]==2],key=lambda e:int(e[0][7:]))
out=[]
CTRL_EXT={1,2,3,4,5,6,7,8,9,11,12,14,15,16,17,18,19,20,21,22,23}
for e in secs:
    d=read(e)
    if comp: d=zlib.decompress(d,-15)
    i=0
    while i+4<=len(d):
        h=struct.unpack_from('<I',d,i)[0];i+=4
        tag=h&0x3ff;size=(h>>20)&0xfff
        if size==0xfff: size=struct.unpack_from('<I',d,i)[0];i+=4
        if tag==67:
            b=d[i:i+size];t=[];j=0
            while j+1<len(b):
                c=struct.unpack_from('<H',b,j)[0]
                if c in CTRL_EXT:
                    if c==9:t.append('\t')
                    j+=16;continue
                if c in(10,13):t.append('\n')
                elif c>=32:t.append(chr(c))
                j+=2
            out.append(''.join(t).rstrip('\n'))
        i+=size
print('\n'.join(out))
