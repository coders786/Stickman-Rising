"""Compose labelled internet/AI/production-rig reference sheets. Requires Pillow."""
from PIL import Image,ImageDraw,ImageFont,ImageOps
from pathlib import Path
import json,textwrap
ROOT=Path('research/arm-reference-assets')
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def font(n):return ImageFont.truetype(FONT,n)
def text(d,xy,s,n=22,fill='#25384a'):d.text(xy,s,font=font(n),fill=fill)
def lines(d,xy,s,width=110,n=23):
 x,y=xy
 for line in textwrap.wrap(s,width):text(d,(x,y),line,n);y+=n+9
 return y
def panel(sheet,name,box,crop=None):
 im=Image.open(ROOT/name).convert('RGB')
 if crop:im=im.crop(crop)
 im=ImageOps.contain(im,(box[2],box[3]));sheet.paste(im,(box[0]+(box[2]-im.width)//2,box[1]+(box[3]-im.height)//2))
def base(title,sub):
 s=Image.new('RGB',(2000,1650),'#dce3e8');d=ImageDraw.Draw(s)
 text(d,(38,28),title,38);text(d,(40,87),sub,22)
 return s,d
rig=Image.open(ROOT/'rig-exposures.png').convert('RGB')
s,d=base('01 / POWER + ARM SILHOUETTE','Internet observation + AI shape exploration + actual production rig. AI is concept art, not anatomical evidence.')
panel(s,'web-running.jpg',(40,155,900,510));panel(s,'ai-power.jpg',(990,135,970,550))
text(d,(40,700),'WEB / Outside Run, Jonathan Beverly / photo: Getty Images',22)
text(d,(990,700),'AI CONCEPT / front drive, rear elbow, negative space',22)
lines(d,(40,765),'KEEP: compact elbow carriage, clear triangle of space beside the ribs, relaxed hand. Use the photo as a visual example, not a universal sprint prescription.',115)
lines(d,(40,870),'ADAPT: rib-height forward hand, longer rear sweep, short angular palm. REJECT: giant forward reach, extra costume detail, rigid fists and both arms held straight behind.',115)
s.paste(rig.crop((0,0,2000,450)),(0,1010))
text(d,(40,1505),'ACTUAL RIG / 100 ms exposure targets / 480 px/s / one stride ~0.458s / pre-contact study',25)
text(d,(40,1560),'Source: run.outsideonline.com/training/run-faster-use-your-arms/ | AI concept generated for this task',20)
s.save('research/arm-sheet-01-power.png')
s,d=base('02 / RECOVERY ARC + 10 Hz TIMING','Design rhythm, not more steps: continuous gait phase -> deliberate 100 ms upper-body exposures.')
panel(s,'web-running.jpg',(40,145,900,500),(210,60,445,250));panel(s,'ai-recovery.jpg',(990,135,970,530))
text(d,(40,690),'WEB PHOTO DETAIL / elbow behind ribs, hand near waistband',22)
text(d,(990,690),'AI CONCEPT / passing shape; reject its over-splayed hand',22)
lines(d,(40,760),'HARMONY: shoulder leads, elbow changes flexion, wrist follows slightly late. The rear stroke opens the elbow; forward recovery folds compactly. No lateral windmill.',115)
# Plot actual hand-space targets, with marked 100ms samples.
p=json.loads((ROOT/'arm-path.json').read_text())
box=(80,950,1000,1490)
def coord(a):return (box[0]+(a['x']+20)/40*(box[2]-box[0]),box[1]+(a['y']-13)/22*(box[3]-box[1]))
d.line([coord(a) for a in p['curve']],fill='#466e82',width=5)
for a in p['exposures']:
 x,y=coord(a);d.ellipse((x-10,y-10,x+10,y+10),fill='#b45230');text(d,(x+14,y-16),f"{a['time']:.1f}s",23)
text(d,(1100,970),'10 POSES / SECOND',34)
lines(d,(1100,1040),'100 ms holds, independent of render FPS. At sprint cadence, roughly 4-5 exposed upper-body poses fit one full stride. The foot planner does not slow to 10 steps/second.',43)
lines(d,(1100,1260),'Layering: 10 Hz arm/core/finger acting; full-rate travel, feet, collision and final weapon/grip IK. Stop, jump and attack interrupt immediately.',43)
text(d,(40,1555),'Curve: actual runningHandMotion() targets | Internet photo: Outside Run / Getty Images | AI: concept only',20)
s.save('research/arm-sheet-02-rhythm.png')
s,d=base('03 / HAND SHAPES + FOLLOW-THROUGH','A soft hand has distinct palm, curled fingers and an opposing thumb—not a ball or four straight spikes.')
panel(s,'ai-hand.jpg',(40,145,1200,560));panel(s,'web-running.jpg',(1330,175,590,480),(267,175,325,230))
text(d,(40,730),'AI HAND STUDY / useful shape language, not a clinical anatomy reference',22)
text(d,(1330,730),'WEB DETAIL / relaxed hand (thumbnail)',19)
lines(d,(40,795),'RECOMPOSE: tapered wrist -> angular palm -> staggered knuckles -> three-segment finger curls. Thumb folds toward index. Curl is stronger on the forward drive and softer behind the hip.',115)
s.paste(rig.crop((0,450,2000,850)),(0,1000))
lines(d,(40,1440),'ACTUAL GAME HANDS: wrist lag <0.1 radians, varied finger curl, no costume highlights. Armed right hand stays closed; final grip endpoints remain owned by IK.',115)
text(d,(40,1560),'Web source: Outside Run / Getty Images | AI hand sketch: generated | Lower panels: actual game renderer',20)
s.save('research/arm-sheet-03-hands.png')
