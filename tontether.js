const fs = require('fs');
const axios = require('axios');
const colors = require('colors');
const args = require('yargs').argv;
const { parse } = require('querystring');
const { DateTime } = require('luxon');
const { HttpsProxyAgent } = require('https-proxy-agent');

class TapTether {
    constructor () {
        this.headers = {
            'Accept': 'application/json, text/plain, */*',
            "User-Agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        }
        this.hideLogsfail = false; //true: ẩn fail - false: hiện fail
        this.linkData = 'data.txt';
        this.linkProxies = '../proxy/proxy.txt';
        this.Threads = 60;
        this.forwhile = 600; //Giây
        this.timeAgain = 10; //Thời gian phản hồi Request, giây;
        this.activeThreads = 0;
        this.indexCounter = 0; 
        this.taskQueue = []; // Hàng đợi cho các nhiệm vụ
        this.proxies = [];
        this.nFail = 0;
        this.nPass = 0;
    }

    coverTime(mSeconds) { 
        var hours = Math.floor(mSeconds / 1e3 / 3600);
        var minutes =  Math.floor((mSeconds / 1e3 % 3600) / 60);      
        return hours + ":" + minutes;
    }

    getTime() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        const Time = hours +':'+ minutes +':'+ seconds;
        return Time;
    };

    loadProxies(file){
        const proxies = fs.readFileSync(file,'utf8').split('\n').map(line => line.trim()).filter(line => line.length > 0);
        if (proxies.length <= 0) { 
            console.log(colors.red('Không tìm thấy Proxy trong File Proxy.txt'));
            process.exit();
        }
        return proxies
    }

    async checkProxyIP(proxyUrl){
        const url = 'https://api.ipify.org?format=json';
        const timeAgain = this.timeAgain * 1000;
        const proxyAgent = new HttpsProxyAgent(proxyUrl);
        try{
            const response = await axios.get(url, {httpsAgent: proxyAgent, timeout: timeAgain});
            if (response.status === 200) {
                return response.data.ip;
            }else{
                return false;
            }   
        } catch(err) {
            return false;
        }
    }

    async loadData(file) {
        const datas = fs.readFileSync(file,'utf8').split('\n').map(line => line.trim()).filter(line => line.length > 0);
        if (datas.length <= 0) {
            console.log(colors.red(`Không tìm thấy dữ liệu`));
            process.exit();
        }
        return datas;
    }

    async countdown(status,t) {
        for (let i = t; i > 0; i--) {
            const hours = String(Math.floor(i / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((i % 3600) / 60)).padStart(2, '0');
            const seconds = String(i % 60).padStart(2, '0');
            if(status == 1){
                process.stdout.write(colors.white(`[Start]Quá trình lặp lại sau: ${hours}:${minutes}:${seconds}     \r`));
            } else if(status == 2) {
                while (this.activeThreads > 0) {
                    process.stdout.write(colors.white(`[*] Loading     \r`));
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    process.stdout.write('                                        \r');
                }
            } else if (status == 3) {
                process.stdout.write(colors.red(`[Axios] Quá trình gửi thất bại, đang thử lại`));
            } else {
                process.stdout.write(colors.white(`[*] Loading     \r`));
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        process.stdout.write('                                        \r');
    }

    async inforUser(data, proxyUrl) {
        const url = 'https://tontether.click/user/me';
        const headers = this.headers;
        const timeAgain = this.timeAgain * 1000;
        this.headers['Authorization'] = 'Bearer ' + data;
        try {
            const res = await axios.get(url, {headers, httpsAgent: new HttpsProxyAgent(proxyUrl), timeout: timeAgain})
            const data = res.data;
            return data;
        } catch (error) {
            return false;
        };
    }

    async claimCoin(coin, data, proxyUrl) {
        const url = 'https://tontether.click/user/click';
        const headers = this.headers;
        const timeAgain = this.timeAgain * 1000;
        this.headers['Authorization'] = 'Bearer ' + data;
        const timeNow = new Date().getTime();
        const datas = {click_count: coin, at: timeNow}
        try {
            const res = await axios.post(url, datas, {headers, httpsAgent: new HttpsProxyAgent(proxyUrl), timeout: timeAgain})
            const data = res.data;
            return data;
        } catch (error) {
            return false;
        };
    }

    async processAcount(data,index){
        let proxyIP = '', Balance = 0, Reward = 0, Status = false, isClaim = true, nCountWhile = 0;
        const parser = parse(data);
        const user = JSON.parse(parser.user);
        const id = user.id;
        const proxy = this.proxies[index % this.proxies.length];
        const [Phost, Pport, Pusername, Ppassword] = proxy.split(':');
        const proxyUrl = `http://${Pusername}:${Ppassword}@${Phost}:${Pport}`;
        proxyIP = await this.checkProxyIP(proxyUrl);
        if (proxyIP === 0) {
            return {index, id, proxy, proxyIP:false};
        } 
        while (isClaim == true) {
            const inforUser = await this.inforUser(data, proxyUrl);
            if (inforUser == false) {
                return {index, id, proxy, proxyIP, inforUser};
            }
            Status = 'Wating';
            Reward = inforUser.data && inforUser.data.last_remaining_clicks;
            Balance = inforUser.data && inforUser.data.usdt_balance.toFixed(5);
            const claimCoin = await this.claimCoin(Reward, data, proxyUrl);
            if (claimCoin == false) {
                return {index, id, proxy, proxyIP, inforUser:{Balance, Status:false}};
            }
            Status = 'Thành công';
            Balance = claimCoin.data && claimCoin.data.usdt_balance.toFixed(5);
            const Claim = claimCoin.data && claimCoin.data.last_remaining_clicks;
            if (Claim < 100 || nCountWhile > 3) {
                isClaim = false;
            }
            nCountWhile++;
        }
        return {index, id, proxy, proxyIP, inforUser:{Balance, Status, Reward, nCountWhile}};
    }

    logAccount(result, completedThreads) {
        let logs = '';
        logs =  `[${this.getTime()}][${completedThreads}][${result.index}][${result.proxyIP}][${colors.green(result.id)}]`;
        if (result.proxyIP == false){
            this.nFail++;
            return this.hideLogsfail == true ? false : logs += `\n\t=> [${colors.red(result.proxy)}] ${colors.red(`=> Die rồi vui lòng kiểm tra lại`)}`;
        } 
        if (result.inforUser == false) {
            this.nFail++;
            return this.hideLogsfail == true ? false : logs += `\n\t${colors.yellow(`=> Không tìm thấy dữ liệu`)}`;
        }
        logs += ` - USDT: ${colors.green(result.inforUser.Balance)}`;
        logs += result.inforUser.Status == 'Thành công' ? `\n\t=> Claim: ${colors.green(result.inforUser.Status)}`: `\n\t=> Claim: ${colors.yellow(result.inforUser.Status)}`;
        logs += result.inforUser.Reward > 0 ? ` - Reward: ${colors.green(result.inforUser.Reward)}`: ` - Reward: ${colors.yellow(result.inforUser.Reward)}`;
        logs += result.inforUser.nCountWhile > 1 ? ` - lặp: ${colors.red(result.inforUser.nCountWhile)}`: ` - lặp: ${colors.green(result.inforUser.nCountWhile)}`;

        this.nPass++;
        return logs
    }

    async processQueque() {
        let completedThreads = 0;
        const Total = this.taskQueue.length;
        while (this.taskQueue.length > 0) {
            if (this.activeThreads < this.Threads) {
                const data = this.taskQueue.shift();
                this.activeThreads++;
                this.processAcount(data, this.indexCounter++)
                    .then((result) => {
                        const logs = this.logAccount(result, completedThreads);
                        if (logs != false) {
                            console.log(logs);
                        }
                        //console.log(result);
                    })
                    .catch((error) => {
                        console.error(`Process for data ${data} failed:`, error);
                    })
                    .finally(() => {
                        this.activeThreads--;
                        completedThreads++;
                    })
            } else {
                await new Promise(resolve => setTimeout(resolve, 100)); // Chờ 100ms trước khi kiểm tra lại
            }
        }
        await this.countdown(2,1) //Loading
        console.log(`Total: ${colors.green(Total)} - Pass: ${colors.green(this.nPass)} - Fail: ${colors.red(this.nFail)} (${this.hideLogsfail == true ? 'ẩn' : 'hiện'})`);
        await this.countdown(1,this.forwhile);//lặp lại
    }

    async main() {
        let nCountWhile = 0;
        const args = require('yargs').argv;
        const dataFile = args.data || this.linkData;
        const marinkitagawa = args.marinkitagawa || false;
        if (!marinkitagawa) {
            console.clear();
        }
        const datas = await this.loadData(dataFile);
        while(true){
            this.proxies = this.loadProxies(this.linkProxies);
            this.taskQueue = [...datas];
            this.nFail = 0;
            this.nPass = 0;
            this.indexCounter = 0; //reset Index sau khi load hết datas
            console.log(`[${this.getTime()}]==================> Start for ${colors.green((nCountWhile + 1))} <==================||`);
            await this.processQueque()
                .finally(() => {
                    nCountWhile++;
                })
            console.clear();
        }
    }
}

(async () => {
    try{
        const app = new TapTether();
        await app.main();
    }catch (error){
        console.error(error);
        process.exit();
    }
})()
