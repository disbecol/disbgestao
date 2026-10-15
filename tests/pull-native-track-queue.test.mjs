import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('GPS nativo mantém cópia local mesmo quando Android ainda indica online',async()=>{
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const source=app.replace(/\}\)\(\);\s*$/,`window.trackTest={
    async start(points){
      authUser={id:'driver-1'};
      pullActiveTrip={id:'trip-1',status:'IN_PROGRESS',trip_code:'PUX-1',plate:'ABC1234'};
      isNativeCapacitor=()=>true;
      getPullNativeTokenV170=async()=> 'token';
      rememberPullGpsSample=()=>{};
      queuePullTrackPointV170=async(tripId,point)=>points.push({tripId,point});
      getBackgroundGeolocationV170=()=>({stop:async()=>{},start:async(options,callback)=>{
        callback({latitude:-6.4,longitude:-35.4,accuracy:12,time:1700000000000});
      }});
      return startPullNativeTrackingV170();
    }
  };})();`);
  const window={APP_CONFIG:{SUPABASE_URL:'https://example.test'},addEventListener(){}};
  vm.runInNewContext(source,{window,document:{addEventListener(){}},navigator:{onLine:true},setInterval(){},setTimeout(){}},{timeout:3000});
  const points=[];
  assert.equal(await window.trackTest.start(points),true);
  assert.equal(points.length,1);
  assert.equal(points[0].tripId,'trip-1');
  assert.equal(points[0].point.latitude,-6.4);
});
