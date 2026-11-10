/** Arcade mechanics in world pixels/seconds, not SI metres. A finite motor
 * supplies impulse; F = m a, drag dissipates energy, contacts absorb normal
 * momentum. No velocity teleport on entry, reversal, or exit. */
import {clamp} from '../core/utils'
import {PLAYER_MASS} from './player-motor'
import {impulseFraction,tractionAcceleration,quadraticDragVelocity,airDragCoefficient} from './motion-laws'
import {DASH_SPEED,type DashVariantCfg} from '../combat/dash'
export type DashForcePhase='load'|'drive'|'coast'|'catch'|'wall'
/** Bounded smooth force envelope. Simulation still integrates in substeps. */
export function powerThrustEnvelope(t:number):number{
  const ease=(x:number)=>{const u=clamp(x,0,1);return u*u*(3-2*u)}
  return ease((t-.10)/.035)*ease((.30-t)/.035)
}
export class DashBody {
  readonly mass=PLAYER_MASS
  deliveredImpulse=0;motorWork=0;wallImpulse=0;wallEnergyLost=0
  age=0;distance=0;vx=0;vy=0;ax=0;ay=0;forceX=0;forceY=0
  phase:DashForcePhase='load'
  private dx=1;private dy=0;private impulse=0;private blocked=false
  private cfg:DashVariantCfg
  /** Bonus drive is armed by a fully charged release, on grounded horizontal dashes. */
  boostEngaged=false
  boosting=false
  constructor(cfg:DashVariantCfg,vx:number,vy:number,dx:number,dy:number,grounded:boolean){
    this.cfg=cfg;this.vx=Number.isFinite(vx)?vx:0;this.vy=Number.isFinite(vy)?vy:0
    // Ground normal cancels downward intent; a down-only dash travels facing.
    const x=Number.isFinite(dx)?dx:1,y=Number.isFinite(dy)?dy:0
    const len=Math.hypot(x,grounded?Math.min(0,y):y)||1
    this.dx=x/len;this.dy=(grounded?Math.min(0,y):y)/len
    if(!this.dx&&!this.dy)this.dx=1
    const along=this.vx*this.dx+this.vy*this.dy
    const target=Math.min(1250,DASH_SPEED*cfg.spd+Math.max(0,along)*.28)
    this.impulse=this.mass*clamp(target-along,0,1500)
  }
  get duration():number{return this.cfg.dur+(this.boostEngaged?.18:0)}
  get progress():number{return clamp(this.age/this.duration,0,1)}
  /** Map authored load/push/flight/catch/recover poses onto force phases.
   * Continuous monotone Hermite retiming; peak push coincides with peak thrust. */
  get poseProgress():number{
    const load=(this.cfg.anticipation??.08)*this.duration,drive=this.cfg.driveDuration??Math.max(.04,(this.duration-load)*.58)
    const xs=[0,Math.max(.0001,load),load+drive*.5,load+drive,this.duration*.82,this.duration]
    const ys=[0,.095,.25,.49,.73,1],t=clamp(this.age,0,this.duration)
    let i=0;while(i<4&&t>xs[i+1])i++
    const h=xs[i+1]-xs[i],u=clamp((t-xs[i])/h,0,1),d=(ys[i+1]-ys[i])/h
    const prev=i>0?(ys[i]-ys[i-1])/(xs[i]-xs[i-1]):d
    const next=i<4?(ys[i+2]-ys[i+1])/(xs[i+2]-xs[i+1]):d
    const m=2*prev*d/(prev+d),n=2*d*next/(d+next),u2=u*u,u3=u2*u
    return clamp((2*u3-3*u2+1)*ys[i]+(u3-2*u2+u)*h*m+(-2*u3+3*u2)*ys[i+1]+(u3-u2)*h*n,0,1)
  }
  get momentum():number{return this.mass*Math.hypot(this.vx,this.vy)}
  get kineticEnergy():number{return .5*this.mass*(this.vx*this.vx+this.vy*this.vy)}
  get momentumX():number{return this.mass*this.vx}
  get momentumY():number{return this.mass*this.vy}
  get impulseBudget():number{return this.impulse}
  blockX():void{
    if(this.blocked)return
    this.wallImpulse=-this.mass*this.vx
    this.wallEnergyLost=.5*this.mass*this.vx*this.vx
    this.blocked=true;this.vx=0;this.phase='wall'
  }
  step(dt:number,grounded:boolean,vx=this.vx,vy=this.vy,powerBoost=false):{x:number;y:number;takeoff:boolean}{
    this.vx=Number.isFinite(vx)?vx:0;this.vy=Number.isFinite(vy)?vy:0
    let remaining=Number.isFinite(dt)?clamp(dt,0,.1):0,x=0,y=0,takeoff=false,airborne=!grounded
    const load=(this.cfg.anticipation??.08)*this.duration
    const drive=this.cfg.driveDuration??Math.max(.04,(this.duration-load)*.58)
    while(remaining>1e-8){
      // Exact phase boundaries + small force steps make 30/60/120 Hz agree.
      let h=Math.min(remaining,1/480)
      for(const boundary of [load,load+drive,.10,.30,this.duration])if(this.age<boundary-1e-8)h=Math.min(h,boundary-this.age)
      const t=this.age+h*.5
      this.boosting=powerBoost && grounded && !this.blocked && Math.abs(this.dx)>.5 && Math.abs(this.dy)<.2 && t>=.10 && t<.30
      if(this.boosting)this.boostEngaged=true
      // Integrate the pulse exactly across each slice: no frame-rate-dependent
      // extra impulse from midpoint sampling or repeated chain steps.
      const thrust=this.impulse*(impulseFraction((this.age+h-load)/drive)-impulseFraction((this.age-load)/drive))/h
      const lifting=this.dy<-.2&&thrust*this.dy/this.mass < -2050
      airborne ||= lifting
      const air=airborne
      takeoff ||= lifting
      // The charged motor remains propulsive after the initial pulse. Report
      // that as drive rather than coast so effects and gameplay observe the
      // real force phase; damping remains separately arcade-tuned.
      this.phase=this.blocked?'wall':t<load?'load':thrust>0||this.boosting?'drive':t<this.duration*.82?'coast':'catch'
      // Quadratic air resistance and separate arcade motion damping use
      // game units, not SI-calibrated values.
      // Lean changes projected area modestly only while moving forward.
      const lean=!air&&this.vx*this.dx>0?clamp((t-load)/.06,0,1)*(this.boosting?1:.7):0
      const drag=airDragCoefficient(lean)+(air?.0006:this.boostEngaged?.0008:.0011),friction=air?0:t<load?180:t>=load+drive?(this.cfg.catchBrake??3000):100
      const opposing=Math.abs(this.vx)>1e-6?Math.sign(this.vx)*tractionAcceleration(friction):0
      let motorX=this.blocked?0:thrust*this.dx
      let motorY=air?thrust*this.dy:0
      // Charged grounded drive is finite and bounded after release.
      // It supplements, rather than restarts, the initial impulse.
      if(this.boosting){
        // Smooth onset and release of the powered thrust, plus a gradual
        // speed governor: no discontinuous force when the boost starts/stops.
        const envelope=powerThrustEnvelope(t)
        const governor=clamp((1700-this.vx*this.dx)/180,0,1)
        motorX+=this.mass*8500*envelope*governor*this.dx
      }
      // Motor power governor: no infinite speed from chains, and no damping
      // of externally supplied velocity just to enforce an arbitrary cap.
      if(Math.hypot(this.vx,this.vy)>(this.boosting?1700:1300)&&motorX*this.vx+motorY*this.vy>0){motorX=0;motorY=0}
      this.ax=motorX/this.mass+(quadraticDragVelocity(this.vx,drag,h)-this.vx)/h-opposing
      this.ay=air?motorY/this.mass+2050+(quadraticDragVelocity(this.vy,2050/(1650*1650),h)-this.vy)/h:0
      const oldX=this.vx,oldY=this.vy
      this.vx+=this.ax*h;this.vy+=this.ay*h
      if(!motorX&&oldX*this.vx<0)this.vx=0 // passive friction never reverses travel
      if(!air)this.vy=0
      this.deliveredImpulse+=Math.hypot(motorX,motorY)*h
      this.motorWork+=(motorX*(oldX+this.vx)+motorY*(oldY+this.vy))*.5*h
      this.forceX=this.ax*this.mass;this.forceY=this.ay*this.mass
      x+=(oldX+this.vx)*.5*h;y+=(oldY+this.vy)*.5*h
      this.age+=h
      remaining-=h
    }
    this.distance+=Math.hypot(x,y)
    return{x,y,takeoff}
  }
}
