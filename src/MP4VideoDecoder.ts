export class Mp4VideoDecoder {

    protected file:any; //mp4Box file
    protected track:any; //mp4box videoTrack
    protected videoDecoder:VideoDecoder|null = null;
    protected fileReady:boolean = false;
    protected frameBuffer:ImageBitmap[] = [];
    protected sampleBuffer:any[] = [];
    protected nbFrameCreated:number = 0;
    protected nbSampleReceived:number = 0;
    protected nbFrameUsed:number = 0;
    protected nbSampleUsed:number = 0;
    protected flushHasBeenCalled:boolean = false;
    protected waitingSample:boolean = false;
    protected waitingFrame:boolean = false;
    protected readComplete:boolean = false;
    //---
    protected nbSampleMaxByCall:number = 30;
    protected nbBufferizedSampleMin:number = 20;
    protected frameBufferMaxLength:number = 10;


    constructor(){

    }

    //-----
    public autoCloseDecoder:boolean = true;
    public closeFrameAfterReading:boolean = true;
    //-----
    public onReadyToDecode:null|(()=>void) = null;
    public onFrameReady:((bmp:ImageBitmap)=>void)|null = null;
    public onReadComplete:null|(()=>void) = null;
    public onloadProgress:null|((pct:number)=>void) = null;
    public onloadComplete:null|(()=>void) = null;
    //-----
    public get id():any{ return this.track.id;}
    
    
    protected outputW:number=1;
    protected outputH:number=1;
    protected outputOptions:ImageBitmapOptions|null = null;
    protected loadComplete:boolean = false;

    public get width():number{return this.outputW;}
    public get height():number{return this.outputH;}
    public get videoWidth():number{return this.track.track_width;}
    public get videoHeight():number{return this.track.track_height;}


    public get loading():boolean{return this.loadComplete == false;}
    public get nbSampleTotal():number{return this.track.nb_samples}
    public get codec():string{return this.track.codec}
    public get timescale():number{return this.track.timescale;}
    public get durationInMillisecond():number{return (this.track.duration / this.track.timescale) * 1000};

    public get framerate():number{ return 1000 / (this.durationInMillisecond / this.nbSampleTotal)};
    public get videoFrameDurationInMicrosecond(){return 1000000 / this.framerate;}
    public get completed():boolean{return this.nbFrameCreated == this.nbSampleTotal};

    public get approximativeAmountOfAvailableFrames():number{return this.approxAvailableFrames;}
    public get readProgressInMillisecond():number{ return (this.nbFrameUsed / this.nbSampleTotal) * this.durationInMillisecond}
    //----


    protected clearSample(sampleId:number):void{ 
        this.file.releaseUsedSamples(this.id,sampleId);
    }



    public init(url:string,outputOptions:ImageBitmapOptions|null=null){   
        
        //WARNING : outputOptions will slow the process if you use it

        this.file = (window["MP4Box" as any] as any).createFile();
        
        this.file.onError = (e:any)=>{
            console.warn("MP4Box file error => ",e);
        }

        this.file.onReady = (info:any)=>{
            this.track = info.videoTracks[0];
            this.fileReady = true;

            if(!outputOptions){
                this.outputW = this.videoWidth;
                this.outputH = this.videoHeight;
                this.outputOptions = null;
            }else{
                this.outputOptions = outputOptions;
                if(outputOptions.resizeWidth && outputOptions.resizeHeight){
                    this.outputW = outputOptions.resizeWidth;
                    this.outputH = outputOptions.resizeHeight;
                }else{
                    this.outputW = this.videoWidth;
                    this.outputH = this.videoHeight;
                }
            }

            this.setupDecoder();
            
            this.update();
           
        }

        this.file.onSamples = (trackId:any, ref:any, samples:any)=>{
            ref;

            //I process the dumux-step little by little in order to save memory 
            //so I stop file reading between 2 demux-process
            
            if(this.id == trackId){

                
                this.pauseDecoding();
                this.sampleBuffer = this.sampleBuffer.concat(samples);
                

                //In order to make seek usable, nbSampleReceived must be based on sample.number 
                //=> it can't be a basic counter; 

                this.nbSampleReceived = samples[samples.length-1].number;
                if(this.seekHasBeenCalled){
                    this.seekHasBeenCalled = false;
                    this.nbFrameCreated = this.nbSampleReceived;
                }
                this.update();
               

                return
            }
        }
        this.loadFile(url);
    }



    private seekHasBeenCalled:boolean = false;

    public seek(timeInSeconds:number){
        if(!this.loadComplete){
            console.warn("Mp4VideoDecoder.seek cannot be used while loading is not completed");
            return;
        }
        
        this.sampleBuffer = [];
        this.frameBuffer = [];
        this.seekHasBeenCalled = true;

        this.file.seek(timeInSeconds,true);
        
        
    }


    public nbFrameDecoded:number=0;
    protected setupDecoder(){

        this.file.setExtractionOptions(this.id,null,{nbSamples:this.nbSampleMaxByCall});

        this.nbFrameDecoded = 0;
        this.videoDecoder = new window["VideoDecoder"]({
            output:(videoFrame)=>{

                createImageBitmap(videoFrame,this.outputOptions as any).then((bmp)=>{


                    let time = videoFrame.timestamp / this.timescale;
                    let frameId = (time * this.framerate >> 0);
                    
                    //In order to make seek usable, I can't use a basic frame counter
                    //nbFrameCreated & nbFrameUsed have to "follow" videoFrame.timestamp

                    this.frameBuffer.push(bmp);
                    this.nbFrameUsed = frameId - (this.frameBuffer.length-1);
                    


                    if(this.waitingFrame){
                        this.waitingFrame = false;
                        this.nextFrame();
                    }
                    
                    this.nbFrameDecoded++;
                    this.nbFrameCreated = frameId;
                    videoFrame.close();
                    
                    this.clearSample(this.nbFrameCreated++);
                    //console.log("frameId = ",frameId+" vs "+this.nbSampleTotal)
                    
                    if(this.nbFrameCreated == this.nbSampleTotal && this.autoCloseDecoder){
                        setTimeout(()=>{
                            console.log("CLOSE DECODER")
                            if(this.videoDecoder) this.videoDecoder.close();
                        },100);
                    }
                })
            },
            error:(err)=>{ console.log("VideoDecoder error: ",err);}
        })

       

        this.videoDecoder.configure({
            codec:this.codec,
            codedWidth:this.videoWidth,
            codedHeight:this.videoHeight,
            description:this.getExtradata(),
            optimizeForLatency:false
        })

        
    }


    protected resumeDecoding():void{ 
        if(this.waitingSample) return;
        this.waitingSample = true;
        this.file.start(); 
    }

    protected pauseDecoding():void{
        if(!this.waitingSample) return;
        this.waitingSample = false;
        this.file.stop();
    }


    

    

    protected update(){

        if(!this.fileReady || !this.videoDecoder) return;


        //handle samples stack ----------------------------------- 
        if(this.sampleBuffer.length < this.nbBufferizedSampleMin){
            //console.log(this.nbSampleReceived+" + "+this.sampleBuffer.length+" < "+this.nbSampleTotal)
            if(this.nbSampleReceived + this.sampleBuffer.length < this.nbSampleTotal){
                this.resumeDecoding();
            }
        }

        //handle chunk stack ------------------------------------

        //console.log("sampleBuffer.length: ",this.sampleBuffer.length," ,nbSampleUsed: ",this.nbSampleUsed," ,nbFrameCreated: ",this.nbFrameCreated)
        if(this.sampleBuffer.length > 0 && this.nbSampleUsed < this.nbSampleTotal && this.nbSampleUsed - this.nbFrameCreated < this.frameBufferMaxLength && this.frameBuffer.length < this.frameBufferMaxLength){
            let dist = this.frameBufferMaxLength - (this.nbSampleUsed - this.nbFrameCreated);
            let i,nb = Math.min(dist,this.sampleBuffer.length);

           
            let sample:any;
            let type:any;
            for(i=0;i<nb;i++){
                sample = this.sampleBuffer.shift();
                
                //console.log("sample = ",sample)
                
                type = sample.is_sync ? "key" : "delta";
                this.videoDecoder.decode(new window["EncodedVideoChunk"]({
                    type: type,
                    timestamp: sample.cts,
                    duration: sample.duration,
                    data: sample.data
                }));
            }
            if(sample){
                //console.log(sample)
                this.nbSampleUsed = sample.number;
            }

            //this.nbSampleUsed += nb;
        }else{
            if(this.nbSampleTotal > 0 && this.nbSampleUsed == this.nbSampleTotal && !this.flushHasBeenCalled){
                this.flushHasBeenCalled = true;
                this.videoDecoder.flush();
            }
        }
    }

    public nextFrame():void{

        if(this.readComplete ) return;

        this.update();

        if(this.frameBuffer.length > 0){
            let bmp:ImageBitmap = this.frameBuffer.shift() as ImageBitmap;
            this.nbFrameUsed++;

            if(this.onFrameReady) this.onFrameReady(bmp);

            if(this.closeFrameAfterReading) bmp.close();

           // console.log("nbFrameUsed = ",this.nbFrameUsed)
            if(this.nbFrameUsed == this.nbSampleTotal){
                this.readComplete = true;
                //console.log("onReadComplete")
                if(this.onReadComplete) this.onReadComplete();
            }
        }else{
            this.waitingFrame = true;
        }
    }




    //--------------------------------------
    
    private approxAvailableFrames:number = 0;
    protected loadFile(url:string){
        
        fetch(url).then((response:any)=>{
            
            let offset = 0;
            let buf;
            var file = this.file;
            let reader = response.body.getReader();
            let started = false;
           
            let push = ()=>{
                return reader.read().then((result:any) => {
                    const { done, value } = result;
                    if(done == true) {
                        file.flush(); 
                        console.log(file)
                        this.approxAvailableFrames = this.nbSampleTotal;
                        this.loadComplete = true;
                        if(this.onloadComplete) this.onloadComplete();
                        if(this.onReadyToDecode && !started) this.onReadyToDecode();
                        return;
                    }
                    
                    buf = value.buffer;
                    buf.fileStart = offset;
                    offset += buf.byteLength;
                    file.appendBuffer(buf);
                    
                    if(this.fileReady){
                        let size = file.mdats[0].size;
                        let start = file.mdats[0].start;
                        let total = size +start;
                        let approximativeframeSize = size / this.nbSampleTotal;

                        this.approxAvailableFrames = Math.floor( (offset - start) / approximativeframeSize);
                        
                        if(this.onloadProgress) this.onloadProgress(offset / total);
                        if(!started && this.approxAvailableFrames >= 100 && this.onReadyToDecode){
                            started = true;
                            this.onReadyToDecode(); 
                        }
                    }
                    
                    push();
                }).catch((e:any)=>{
                    console.log(e)
                })
                
            };

            push();
    
        })
    }
    //--------------
    protected getExtradata():Uint8Array{
        // generate the property "description" for the object used in VideoDecoder.configure
        // This function have been written by Thomas Guilbert from Google

        let avccBox = this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].avcC;

        let i,size = 7;
        for (i=0;i<avccBox.SPS.length; i++) size+= 2 + avccBox.SPS[i].length;
        for (i=0;i<avccBox.PPS.length; i++) size+= 2 + avccBox.PPS[i].length;

        let id = 0;
        let data = new Uint8Array(size);

        let writeUint8 = (value:number)=>{
            data.set([value],id);
            id++;
        }
        let writeUint16 = (value:number)=>{
            let arr = new Uint8Array(1);
            arr[0] = value;
            let buffer = new Uint8Array(arr.buffer);
            data.set([buffer[1], buffer[0]], id);
            id += 2;
        }
        let writeUint8Array = (value:number[])=>{
            data.set(value,id);
            id += value.length;
        }

        writeUint8(avccBox.configurationVersion);
        writeUint8(avccBox.AVCProfileIndication);
        writeUint8(avccBox.profile_compatibility);
        writeUint8(avccBox.AVCLevelIndication);
        writeUint8(avccBox.lengthSizeMinusOne + (63<<2));
        writeUint8(avccBox.nb_SPS_nalus + (7<<5));

        for (i = 0; i < avccBox.SPS.length; i++) {
            writeUint16(avccBox.SPS[i].length);
            writeUint8Array(avccBox.SPS[i].nalu);
        }
    
        writeUint8(avccBox.nb_PPS_nalus);
        for (i = 0; i < avccBox.PPS.length; i++) {
            writeUint16(avccBox.PPS[i].length);
            writeUint8Array(avccBox.PPS[i].nalu);
        }

        if(id != size) throw "size mismatched !"
        return data;
    }
}