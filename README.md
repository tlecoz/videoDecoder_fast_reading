A working example showing how to read a MP4 as fast as possible using WebCodec

```
import { Mp4VideoDecoder } from "./MP4VideoDecoder";

const fpsTxt = document.body.appendChild(document.createElement("div"));

let mp4Decoder = new Mp4VideoDecoder();
let canvas:HTMLCanvasElement = document.createElement("canvas");
document.body.appendChild(canvas);


let time:number;
mp4Decoder.onReadyToDecode = ()=>{
  time = new Date().getTime();
  canvas.width = mp4Decoder.width;
  canvas.height = mp4Decoder.height;
  mp4Decoder.nextFrame();
}


let fps = 0;
mp4Decoder.onFrameReady = (bmp:ImageBitmap)=>{
  if(new Date().getTime() - time >= 1000){
      time += 1000;
      fpsTxt.innerText = fps+" FPS"
      fps = 0;
  }
  fps++;
  (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(bmp,0,0);
  mp4Decoder.nextFrame();
}


mp4Decoder.onReadComplete = ()=>{ console.log("complete");}

mp4Decoder.init("./bbb.mp4")

```

How to run : 

```
npm install 
npm run dev
```