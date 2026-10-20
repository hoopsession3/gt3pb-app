import sys
def varint(b,i):
    s=0;r=0
    while True:
        c=b[i];i+=1;r|=(c&0x7f)<<s;s+=7
        if c<0x80: return r,i
def parse(b):
    i=0;out=[]
    while i<len(b):
        k,i=varint(b,i);f,t=k>>3,k&7
        if f==0: raise ValueError
        if t==0: v,i=varint(b,i);out.append((f,'v',v))
        elif t==1: out.append((f,'64',b[i:i+8]));i+=8
        elif t==5: out.append((f,'32',b[i:i+4]));i+=4
        elif t==2:
            n,i=varint(b,i);v=b[i:i+n];i+=n
            if i>len(b): raise ValueError
            out.append((f,'b',v))
        else: raise ValueError
    return out
def show(b,d=0,maxd=8):
    for f,t,v in parse(b):
        if t=='b':
            sub=None
            if d<maxd and len(v)>1:
                try: sub=parse(v)
                except Exception: sub=None
            txt=None
            try:
                txt=v.decode('utf-8')
                if not txt.isprintable() and '\n' not in txt: txt=None
            except: pass
            if txt and (sub is None or len(txt)>3 and sum(c.isalpha() for c in txt)>len(txt)*0.5):
                print('  '*d+f'{f}: "{txt[:90]}"')
            elif sub is not None:
                print('  '*d+f'{f}: {{ ({len(v)}b)'); show(v,d+1,maxd)
            else: print('  '*d+f'{f}: <{len(v)}b {v[:16].hex()}>')
        else: print('  '*d+f'{f}: {t} {v if t=="v" else v.hex()}')
if __name__=='__main__':
    show(open(sys.argv[1],'rb').read(), maxd=int(sys.argv[2]) if len(sys.argv)>2 else 8)
