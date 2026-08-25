import { PrismaClient } from '@prisma/client'
import { LEGACY_ORGANIZATION_ID } from '../src/lib/tenancy'
const prisma=new PrismaClient();const DAY=86400000
const scenarios=[
 {email:'employee@ds.ie',home:['Phibsborough, Dublin 7',53.3597,-6.2735],school:['TU Dublin Grangegorman','Grangegorman Lower, Dublin 7',53.3475,-6.2771],target:1800,mode:'transit',study:[1,2,3,4,5].map(dayOfWeek=>({dayOfWeek,startsMinute:480,endsMinute:780}))},
 {email:'maria@ds.ie',home:['Rathmines, Dublin 6',53.3242,-6.2656],school:['Dublin Business School','Aungier Street, Dublin 2',53.3408,-6.2641],target:1500,mode:'cycling',study:[1,3,5].map(dayOfWeek=>({dayOfWeek,startsMinute:540,endsMinute:960})),schoolHoliday:true},
 {email:'john@ds.ie',home:['Drumcondra, Dublin 9',53.3668,-6.2586],school:['DCU Glasnevin','Glasnevin, Dublin 9',53.3853,-6.256],target:1800,mode:'transit',study:[{dayOfWeek:1,startsMinute:540,endsMinute:720},{dayOfWeek:2,startsMinute:840,endsMinute:1080},{dayOfWeek:4,startsMinute:600,endsMinute:960}]},
 {email:'emma@ds.ie',home:['Clontarf, Dublin 3',53.3639,-6.1938],school:['Trinity College Dublin','College Green, Dublin 2',53.3438,-6.2546],target:1800,mode:'cycling',study:[1,2,3,4].map(dayOfWeek=>({dayOfWeek,startsMinute:840,endsMinute:1080}))},
 {email:'michael@ds.ie',home:['Stoneybatter, Dublin 7',53.3488,-6.2926],school:['National College of Ireland','Mayor Street Lower, IFSC',53.349,-6.2456],target:1200,mode:'driving',study:[2,4].map(dayOfWeek=>({dayOfWeek,startsMinute:1080,endsMinute:1290})),personalLeave:true},
 {email:'gabriel.moda@ds.ie',home:['Dundrum, Dublin 14',53.2897,-6.2437],school:null,target:2100,mode:'driving',study:[]},
 {email:'super@ds.ie',home:['Tallaght, Dublin 24',53.2878,-6.3411],school:['Workforce Test College','Dublin 2',53.3434,-6.2672],target:1800,mode:'transit',study:[1,2,3,4,5,6,7].map(dayOfWeek=>({dayOfWeek,startsMinute:0,endsMinute:1440})),alwaysSchool:true},
] as const

function atDaysAgo(daysAgo:number,hour:number){
 const d=new Date();d.setHours(hour,0,0,0);d.setDate(d.getDate()-daysAgo);return d
}
const workedPatterns:Record<string,Array<[number,number]>>={
 'maria@ds.ie':[[1,5],[2,6],[3,4],[4,5]],
 'employee@ds.ie':[[1,7],[2,7],[3,6],[4,7],[5,5]],
 'emma@ds.ie':[[1,3],[2,4],[3,5]],
 'john@ds.ie':[[1,8],[2,8],[3,8],[4,7]],
 'gabriel.moda@ds.ie':[[1,2],[2,2]],
 'super@ds.ie':[[1,6],[2,6],[3,6],[4,6],[5,6]],
}

async function main(){
 const now=new Date()
 for(const x of scenarios){
  const u=await prisma.user.findUnique({where:{email:x.email},select:{id:true}})
  if(!u)continue
  const school=x.school
  const p=await prisma.workforceProfile.upsert({
   where:{userId:u.id},
   update:{homeAddress:x.home[0],homeLatitude:x.home[1],homeLongitude:x.home[2],schoolName:school?.[0]??null,schoolAddress:school?.[1]??null,schoolLatitude:school?.[2]??null,schoolLongitude:school?.[3]??null,weeklyTargetMinutes:x.target,travelMode:x.mode},
   create:{organizationId:LEGACY_ORGANIZATION_ID,userId:u.id,homeAddress:x.home[0],homeLatitude:x.home[1],homeLongitude:x.home[2],schoolName:school?.[0]??null,schoolAddress:school?.[1]??null,schoolLatitude:school?.[2]??null,schoolLongitude:school?.[3]??null,weeklyTargetMinutes:x.target,travelMode:x.mode},
  })
  await prisma.studySchedule.deleteMany({where:{profileId:p.id}})
  await prisma.workforceLeave.deleteMany({where:{profileId:p.id}})
  if(x.study.length)await prisma.studySchedule.createMany({data:x.study.map(r=>({organizationId:LEGACY_ORGANIZATION_ID,profileId:p.id,...r}))})
  if('schoolHoliday' in x&&x.schoolHoliday)await prisma.workforceLeave.create({data:{organizationId:LEGACY_ORGANIZATION_ID,profileId:p.id,kind:'school_holiday',startsAt:new Date(now.getTime()-DAY),endsAt:new Date(now.getTime()+5*DAY),reason:'Demo school break'}})
  if('personalLeave' in x&&x.personalLeave)await prisma.workforceLeave.create({data:{organizationId:LEGACY_ORGANIZATION_ID,profileId:p.id,kind:'personal_leave',startsAt:new Date(now.getTime()-DAY),endsAt:new Date(now.getTime()+4*DAY),reason:'Demo personal holiday'}})

  const pattern=workedPatterns[x.email]??[]
  for(const [daysAgo,workedHours] of pattern){
   const startedAt=atDaysAgo(daysAgo,9),endedAt=new Date(startedAt.getTime()+workedHours*3600000)
   const clientMutationId=`workforce-demo-v4:${x.email}:${startedAt.toISOString().slice(0,10)}`
   await prisma.timeEntry.upsert({
    where:{organizationId_clientMutationId:{organizationId:LEGACY_ORGANIZATION_ID,clientMutationId}},
    update:{startedAt,endedAt,durationSeconds:workedHours*3600,status:'approved',kind:'general',source:'workforce-demo-v4'},
    create:{organizationId:LEGACY_ORGANIZATION_ID,userId:u.id,kind:'general',status:'approved',startedAt,endedAt,durationSeconds:workedHours*3600,source:'workforce-demo-v4',clientMutationId},
   })
  }
 }
 console.log(`Seeded ${scenarios.length} workforce profiles and demo worked-hour scenarios.`)
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect())
