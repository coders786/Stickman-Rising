from PIL import Image,ImageDraw,ImageFilter
import random,math
random.seed(9471); W,H=1280,720
im=Image.new('RGB',(W,H)); p=im.load()
for y in range(H):
 u=y/H
 stops=[(0,(3,6,16)),(.48,(9,19,31)),(.78,(23,36,44)),(1,(41,51,55))]
 for i in range(len(stops)-1):
  if stops[i][0]<=u<=stops[i+1][0]:
   a,c=stops[i];b,d=stops[i+1];q=(u-a)/(b-a);col=tuple(int(c[k]*(1-q)+d[k]*q) for k in range(3));break
 for x in range(W):p[x,y]=col
d=ImageDraw.Draw(im,'RGBA')
for i in range(125):
 x=random.randrange(W);y=random.randrange(int(H*.56));a=random.randrange(35,150);d.ellipse((x,y,x+1,y+1),fill=(205,221,222,a))
# moon halo on layer
hl=Image.new('RGBA',(W,H));h=ImageDraw.Draw(hl,'RGBA')
for r in range(150,55,-3):
 a=int(1.8*(150-r));a=max(0,min(22,a));h.ellipse((930-r,150-r,930+r,150+r),fill=(130,160,165,a))
h.ellipse((872,92,988,208),fill=(205,207,197,255));hl=hl.filter(ImageFilter.GaussianBlur(2));im=Image.alpha_composite(im.convert('RGBA'),hl);d=ImageDraw.Draw(im,'RGBA')
# mountains
for base,amp,col,step in [(475,125,(16,25,35,255),120),(510,100,(11,20,27,255),95),(550,76,(9,17,22,255),75)]:
 pts=[(0,H),(0,base)];x=0
 while x<W+step:pts.append((x,base-random.randint(int(amp*.25),amp)));x+=step
 pts +=[(W,H)];d.polygon(pts,fill=col)
# shafts
shaft=Image.new('RGBA',(W,H));sd=ImageDraw.Draw(shaft,'RGBA')
for x,a in [(805,18),(900,12)]:sd.polygon([(x,205),(x+30,205),(x+205,535),(x+100,535)],fill=(176,201,202,a))
shaft=shaft.filter(ImageFilter.GaussianBlur(18));im=Image.alpha_composite(im,shaft);d=ImageDraw.Draw(im,'RGBA')
# shrine
d.rectangle((180,390,435,535),fill=(15,19,21,255));d.polygon([(135,400),(308,332),(480,400)],fill=(7,10,11,255));d.rectangle((284,442,332,535),fill=(78,44,37,90))
# trees
for base,sgn in [(105,1),(1170,-1)]:
 d.line((base,540,base+30*sgn,340,base-15*sgn,135),fill=(6,9,10,255),width=35,joint='curve')
 for k in range(5):
  y=210+k*35;d.line((base,y,base+sgn*(80+k*35),y-random.randrange(20,75)),fill=(6,9,10,255),width=max(7,15-k))
# blossom clusters
for side in [100,1160]:
 for i in range(50):
  x=int(random.gauss(side,100));y=int(random.gauss(230,85));r=random.randrange(2,10);d.ellipse((x-r,y-r,x+r,y+r),fill=(145,116,132,random.randrange(16,42)))
# fog blurred
fog=Image.new('RGBA',(W,H));f=ImageDraw.Draw(fog,'RGBA')
for x,y,rx,ry,a in [(390,460,370,50,24),(880,490,430,55,29),(650,400,310,35,16)]:f.ellipse((x-rx,y-ry,x+rx,y+ry),fill=(145,171,172,a))
fog=fog.filter(ImageFilter.GaussianBlur(24));im=Image.alpha_composite(im,fog);d=ImageDraw.Draw(im,'RGBA')
# ground
d.rectangle((0,530,W,H),fill=(14,20,21,255))
for x in range(-100,W,110):d.line((x,532,x+180,H),fill=(125,145,143,10),width=1)
for i in range(13):
 y=548+i*4;ww=30+i*12;d.rectangle((930-ww//2+int(math.sin(i*7)*20),y,930+ww//2,y+1),fill=(180,200,196,max(5,25-i)))
# clarity pool
pool=Image.new('RGBA',(W,H));q=ImageDraw.Draw(pool,'RGBA');q.ellipse((380,350,900,650),fill=(100,127,128,27));pool=pool.filter(ImageFilter.GaussianBlur(65));im=Image.alpha_composite(im,pool);d=ImageDraw.Draw(im,'RGBA')
# player proof silhouette
cx,gy=640,530;d.ellipse((cx-13,gy-116,cx+13,gy-90),fill=(1,2,3,255));d.line((cx,gy-90,cx-2,gy-45),fill=(1,2,3,255),width=12);d.line((cx-2,gy-75,cx-30,gy-50),fill=(1,2,3,255),width=8);d.line((cx-2,gy-74,cx+28,gy-48),fill=(1,2,3,255),width=8);d.line((cx-2,gy-45,cx-23,gy),fill=(1,2,3,255),width=9);d.line((cx-2,gy-45,cx+21,gy),fill=(1,2,3,255),width=9)
# silver rim
d.arc((cx-14,gy-116,cx+14,gy-88),-65,70,fill=(175,190,185,180),width=2);d.line((cx+6,gy-86,cx+4,gy-50),fill=(175,190,185,140),width=2);d.line((cx+6,gy-68,cx+30,gy-48),fill=(175,190,185,140),width=2);d.line((cx+4,gy-42,cx+22,gy-2),fill=(175,190,185,140),width=2);d.ellipse((608,525,672,539),fill=(0,0,0,145))
# petals
for i in range(18):
 x=random.randrange(W);y=random.randrange(100,540);r=random.randrange(2,6);d.ellipse((x-r,y-r//2,x+r,y+r//2),fill=(183,160,172,random.randrange(50,150)))
# vignette
vig=Image.new('RGBA',(W,H));v=ImageDraw.Draw(vig,'RGBA')
for i in range(120):
 a=int(i/120*2);v.rectangle((i,i,W-i,H-i),outline=(0,3,10,a),width=2)
im=Image.alpha_composite(im,vig);im.convert('RGB').save('art/ultra-zen-shader-preview.png',quality=95)
