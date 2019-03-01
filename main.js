const superagent = require("superagent")
const cheerio = require("cheerio")
const nodemailer = require("nodemailer")
const ejs = require("ejs")
const fs = require("fs")
const path = require("path")
const schedule = require("node-schedule")
const logger = require("./logger")

function wait(ms) {
    return new Promise(res => {
        setTimeout(res, ms)
    })
}

let tryTimes = 0
const MaxTryTimes = 3

//配置项
const config = JSON.parse(fs.readFileSync("./config.json"))

//纪念日
let startDay = config.startDay
//当地拼音,需要在下面的墨迹天气url确认
const local = config.local

//发送者邮箱厂家
let emailService = config.emailService
//发送者邮箱账户SMTP授权码
let emailAuth = config.emailAuth
//发送者昵称与邮箱地址
let emailFrom = config.emailFrom

//接收者邮箱地
let emailTo = config.emailTo
//邮件主题
let emailSubject = config.emailSubject

//每日发送时间
let emailHour = config.emailHour
let emailMinute = config.emailMinute

// 爬取数据的url
const OneUrl = "http://wufazhuce.com/"
const WeatherUrl = "https://tianqi.moji.com/weather/china/" + local

// 获取ONE内容
function getOneData() {
    let p = new Promise(function(resolve, reject) {
        superagent.get(OneUrl).end(function(err, res) {
            if (err) {
                reject(err)
            }
            let $ = cheerio.load(res.text)
            let selectItem = $("#carousel-one .carousel-inner .item")
            let todayOne = selectItem[0]
            let todayOneData = {
                imgUrl: $(todayOne)
                    .find(".fp-one-imagen")
                    .attr("src"),
                type: $(todayOne)
                    .find(".fp-one-imagen-footer")
                    .text()
                    .replace(/(^\s*)|(\s*$)/g, ""),
                text: $(todayOne)
                    .find(".fp-one-cita")
                    .text()
                    .replace(/(^\s*)|(\s*$)/g, ""),
            }
            resolve(todayOneData)
        })
    })
    return p
}

// 获取天气提醒
function getWeatherTips(res) {
    let weatherTip = ""
    let $ = cheerio.load(res.text)
    $(".wea_tips").each(function(i, elem) {
        weatherTip = $(elem)
            .find("em")
            .text()
    })
    return weatherTip
}

function getWeatherData(res) {
    let threeDaysData = []
    let $ = cheerio.load(res.text)
    $(".forecast .days").each(function(i, elem) {
        const SingleDay = $(elem).find("li")
        threeDaysData.push({
            Day: $(SingleDay[0])
                .text()
                .replace(/(^\s*)|(\s*$)/g, ""),
            WeatherImgUrl: $(SingleDay[1])
                .find("img")
                .attr("src"),
            WeatherText: $(SingleDay[1])
                .text()
                .replace(/(^\s*)|(\s*$)/g, ""),
            Temperature: $(SingleDay[2])
                .text()
                .replace(/(^\s*)|(\s*$)/g, ""),
            WindDirection: $(SingleDay[3])
                .find("em")
                .text()
                .replace(/(^\s*)|(\s*$)/g, ""),
            WindLevel: $(SingleDay[3])
                .find("b")
                .text()
                .replace(/(^\s*)|(\s*$)/g, ""),
            Pollution: $(SingleDay[4])
                .text()
                .replace(/(^\s*)|(\s*$)/g, ""),
            PollutionLevel: $(SingleDay[4])
                .find("strong")
                .attr("class"),
        })
    })
    return threeDaysData
}

// 获取天气预报
function getWeather(tryTimes = 0) {
    const MaxTryTimes = 10
    return new Promise(function(resolve, reject) {
        superagent.get(WeatherUrl).end(function(err, res) {
            if (err) {
                tryTimes += 1
                if (tryTimes > MaxTryTimes) {
                    reject(err)
                }
                resolve(wait(1000).then(() => getWeather(tryTimes)))
            }
            const weatherTips = getWeatherTips(res)
            const threeDaysData = getWeatherData(res)
            if (!weatherTips && threeDaysData.length === 0) {
                tryTimes += 1
                if (tryTimes > MaxTryTimes) {
                    reject(err)
                }
                resolve(wait(1000).then(() => getWeather(tryTimes)))
            }
            resolve([weatherTips, threeDaysData])
        })
    })
}

// 发动邮件
function sendMail(HtmlData) {
    const template = ejs.compile(
        fs.readFileSync(path.resolve(__dirname, "email.ejs"), "utf8")
    )
    const html = template(HtmlData)

    let transporter = nodemailer.createTransport({
        service: emailService,
        port: 465,
        secureConnection: true,
        auth: emailAuth,
    })

    let mailOptions = {
        from: emailFrom,
        to: emailTo,
        subject: emailSubject,
        html: html,
    }
    transporter.sendMail(mailOptions, (error, info = {}) => {
        if (error) {
            logger(error)
            tryTimes += 1
            if (tryTimes > MaxTryTimes) {
                logger("已超过最大尝试次数，本次发送任务失败")
                // TODO: 提醒发送人
                return
            }
            sendMail(HtmlData) //再次发送
            return
        }
        logger("邮件发送成功", info.messageId)
        logger("静等下一次发送")
    })
}

// 聚合
function getAllDataAndSendMail() {
    let HtmlData = {}
    // how long with
    let today = new Date()
    let initDay = new Date(startDay)
    let lastDay = Math.floor((today - initDay) / 1000 / 60 / 60 / 24)
    let todaystr =
        today.getFullYear() +
        " / " +
        (today.getMonth() + 1) +
        " / " +
        today.getDate()
    HtmlData["lastDay"] = lastDay
    HtmlData["todaystr"] = todaystr

    Promise.all([getOneData(), getWeather()])
        .then(function(data) {
            HtmlData["todayOneData"] = data[0]
            HtmlData["weatherTip"] = data[1][0]
            HtmlData["threeDaysData"] = data[1][1]
            sendMail(HtmlData)
        })
        .catch(function(err) {
            tryTimes += 1
            if (tryTimes > MaxTryTimes) {
                logger("已超过最大尝试次数，本次发送任务失败")
                // TODO: 提醒发送人
                return
            }
            logger("获取数据失败： ", err)
            logger(`重新尝试发送（${tryTimes}）...`)
            getAllDataAndSendMail() //再次获取
        })
}

let rule = new schedule.RecurrenceRule()
rule.dayOfWeek = [0, new schedule.Range(1, 6)]
rule.hour = emailHour
rule.minute = emailMinute

logger(
    `等待目标时刻[${emailHour
        .toString()
        .padStart(2, "0")}:${emailMinute.toString().padStart(2, "0")}]`
)
getAllDataAndSendMail()
let j = schedule.scheduleJob(rule, function() {
    logger("开始执行任务")
    tryTimes = 0
    getAllDataAndSendMail()
})
