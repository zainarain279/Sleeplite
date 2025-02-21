const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents");
const settings = require("./config/config");
const { sleep, loadData, getRandomNumber, saveToken, isTokenExpired, saveJson, updateEnv } = require("./utils");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./checkAPI");

class ClientAPI {
  constructor(queryId, accountIndex, proxy, baseURL) {
    this.headers = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/json",
      Origin: "https://tgcf.sleepagotchi.com",
      referer: "https://tgcf.sleepagotchi.com/",
      "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    };
    this.baseURL = baseURL;
    this.queryId = queryId;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      const telegramauth = this.queryId;
      const userData = JSON.parse(decodeURIComponent(telegramauth.split("user=")[1].split("&")[0]));
      this.session_name = userData.id;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent, try get new query_id: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const accountPrefix = `[Tài khoản ${this.accountIndex + 1}]`;
    const ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(url, method, data = {}, retries = 1) {
    const headers = {
      ...this.headers,
    };
    const proxyAgent = new HttpsProxyAgent(this.proxy);
    let currRetries = 0,
      success = false;
    do {
      try {
        const response = await axios({
          method,
          url: `${url}?${this.queryId}`,
          data,
          headers,
          httpsAgent: proxyAgent,
          timeout: 30000,
        });
        success = true;
        return { success: true, data: response.data };
      } catch (error) {
        if (error.status == 400) {
          return { success: false, error: error.message };
        }
        this.log(`Yêu cầu thất bại: ${url} | ${error.message} | đang thử lại...`, "warning");
        success = false;
        await sleep(settings.DELAY_BETWEEN_REQUESTS);
        if (currRetries == retries) return { success: false, error: error.message };
      }
      currRetries++;
    } while (currRetries <= retries && !success);
  }

  async getUserInfo() {
    return this.makeRequest(`${this.baseURL}/getUserData`, "get");
  }

  async getReff() {
    return this.makeRequest(`${this.baseURL}/getReferralsInfo`, "post", {
      page: 1,
      rowsPerPage: 20,
    });
  }
  async claimReff() {
    return this.makeRequest(`${this.baseURL}/claimReferralRewards`, "get");
  }

  async getAllHeroes() {
    return this.makeRequest(`${this.baseURL}/getAllHeroes`, "get");
  }

  async levelUpHero(payload) {
    return this.makeRequest(`${this.baseURL}/levelUpHero`, "post", payload);
  }

  async starUpHero(payload) {
    return this.makeRequest(`${this.baseURL}/starUpHero`, "post", payload);
  }

  async claimChallengesRewards() {
    return this.makeRequest(`${this.baseURL}/claimChallengesRewards`, "get");
  }

  async getShop() {
    return this.makeRequest(`${this.baseURL}/getShop`, "get");
  }

  async getConstellations(payload) {
    return this.makeRequest(`${this.baseURL}/getConstellations`, "post", payload);
  }

  async getClans() {
    return this.makeRequest(`${this.baseURL}/listClans`, "post", {
      page: 1,
      rowsPerPage: 20,
      search: "",
    });
  }

  async joinClan(id) {
    return this.makeRequest(`${this.baseURL}/joinClan`, "post", {
      clanId: id,
    });
  }

  async useRedeemCode(code) {
    return this.makeRequest(`${this.baseURL}/useRedeemCode`, "post", {
      code: code,
    });
  }

  async unlockChallenge(payload) {
    //     {
    //     "challengeType": "greenChallenge040"
    // }
    return this.makeRequest(`${this.baseURL}/unlockChallenge`, "post", payload);
  }

  async sendToChallenge(payload) {
    return this.makeRequest(`${this.baseURL}/sendToChallenge`, "post", payload);
  }

  async byShop() {
    return this.makeRequest(`${this.baseURL}/buyShop`, "post", {
      slotType: "free",
    });
  }

  async spendGacha(payload) {
    return this.makeRequest(`${this.baseURL}/spendGacha`, "post", payload);
  }

  async getDailyRewards() {
    return this.makeRequest(`${this.baseURL}/getDailyRewards`, "get");
  }

  async claimDailyRewards() {
    return this.makeRequest(`${this.baseURL}/claimDailyRewards`, "get");
  }

  async resetHero(heroType) {
    return this.makeRequest(`${this.baseURL}/resetHero`, "post", { heroType: heroType });
  }

  async getClanDetail(id) {
    return this.makeRequest(`${this.baseURL}/getClan`, "post", {
      clanId: id,
    });
  }

  async getValidToken(isRf = false) {
    const userId = this.session_name;
    const existingToken = this.token;
    const existingRefreshToken = this.rfToken;
    let loginResult = null;

    const isExp = isTokenExpired(!isRf ? existingToken : existingRefreshToken);
    if (!isRf && existingToken && !isExp) {
      this.log("Using valid token", "success");
      return { access_token: existingToken, refresh_token: existingRefreshToken };
    } else if (!isRf && existingToken && isExp) {
      this.log("Token expired, refreshing token...", "info");
      return await this.getValidToken(true);
    } else if (isRf && existingRefreshToken && !isExp) {
      loginResult = await this.refreshToken();
    } else {
      this.log("Token not found or expired, logging in...", "warning");
      loginResult = await this.auth();
    }
    // console.log(loginResult);
    if (loginResult?.success) {
      const { refresh_token, access_token } = loginResult?.data;
      if (access_token) {
        saveToken(userId, access_token);
        this.token = access_token;
      }
      if (refresh_token) {
        saveJson(userId, refresh_token, "refresh_token.json");
        this.rfToken = refresh_token;
      }
      return { access_token: access_token, refresh_token: refresh_token };
    } else {
      this.log(`Can't get token, try get new query_id!`, "warning");
    }
    return { access_token: null, refresh_token: null };
  }

  async handleDaily(data) {
    const { meta } = data;
    if (!meta.isNextDailyRewardAvailable) return this.log(`You checked in today!`, "warning");
    const resDaily = await this.getDailyRewards();

    if (resDaily.success) {
      const { rewards } = resDaily.data;
      const today = rewards.find((r) => r.state == "availible");
      if (today) {
        this.log(`Start chekin...`);
        const resCheck = await this.claimDailyRewards();
        if (resCheck.success) {
          this.log(`Checkin success! | Reward: ${today.rewardAmount} ${today.rewardType}`, "success");
        }
      }
    }
  }

  async handleGacha(data) {
    const { resources, meta } = data;
    let totalTicket = resources.gacha.amount;
    let resGacha = { success: false };
    if (Date.now() > meta.freeGachaNextClaim) {
      resGacha = await this.spendGacha({
        amount: 1,
        strategy: "free",
      });
      if (resGacha.success) {
        for (const hero of resGacha.data.heroes) this.log(`Gacha free success! Reward: ${hero.heroType}`, "custom");
      }
    }

    while (totalTicket > 0) {
      await sleep(1);
      if (totalTicket >= 10) {
        resGacha = await this.spendGacha({
          amount: 10,
          strategy: "gacha",
        });
        totalTicket -= 10;
      } else {
        resGacha = await this.spendGacha({
          amount: 1,
          strategy: "gacha",
        });
        totalTicket--;
      }
      if (resGacha.success) {
        for (const hero of resGacha.data.heroes) this.log(`Gacha success! Reward: ${hero.heroType}`, "custom");
      }
    }

    return;
  }

  async handleResetHeroes(data) {
    this.log(`Checking hero to reset...`);
    let { heroes, resources } = data;
    const { greenStones, gold, gem } = resources;
    let goldAvailable = gold.amount,
      gemAvailable = gem.amount,
      greenStonesAvailable = greenStones.amount;

    const resets = heroes
      .map((hero) => {
        let type;
        if (hero.heroType.endsWith("3") || hero.heroType.endsWith("Legendary")) {
          type = "Legendary"; // Hậu tố 3 là Legendary
        } else if (hero.heroType.endsWith("2") || hero.heroType.endsWith("Epic")) {
          type = "Epic"; // Hậu tố 2 là Epic
        } else {
          type = "Rare"; // Hậu tố Rare
        }
        return {
          ...hero,
          type,
        };
      })
      .filter((h) => settings.TYPE_HERO_RESET.includes(h.type) && h.level > 1);

    if (resets.length == 0) {
      this.log(`No hero available to reset!`, "warning");
      return data;
    }
    for (const hero of resets) {
      if (gem.amount < 100) {
        this.log(`Not enough Gem to reset!`, "warning");
        return data;
      }
      await sleep(1);
      this.log(`Resetting hero ${hero.name} | type: ${hero.type}...`);
      const result = await this.resetHero(hero.heroType);

      if (result.success) {
        const { rewards } = result.data;
        greenStonesAvailable = greenStonesAvailable + rewards.greenStones.amount;
        goldAvailable = goldAvailable + rewards.gold.amount;
        gemAvailable -= 100;
        const newHereos = heroes.filter((h) => h.heroType !== result.data.heroType);
        data["heroes"] = [...newHereos, result.data];
        this.log(`Reset hero ${hero.name} successful! | Green stone: ${greenStonesAvailable} | Gold: ${goldAvailable} | Gem: ${gemAvailable}`, "success");
      } else {
        this.log(`Reset hero ${hero.name} failed!`, "warning");
      }
    }

    const { data: userInfo } = await this.getUserInfo();
    if (userInfo) {
      return userInfo.player;
    }
    return data;
  }

  async handleUpgradeHeroes(data) {
    // const { data: userInfo } = await this.getUserInfo();
    // if (!userInfo) return;
    // data = userInfo.player;
    this.log(`Checking upgrade hero...`);
    let { heroes, resources } = data;
    const { greenStones, gold, heroCard } = resources;
    let goldAvailable = gold.amount,
      greenStonesAvailable = greenStones.amount;

    const typeMapping = {
      Legendary: 1,
      Epic: 2,
      Rare: 3,
    };

    const upgrades = heroes
      .map((hero) => {
        let type,
          cards = 0;
        const item = heroCard.find((h) => h.heroType === hero.heroType);
        if (item) {
          cards = item.amount;
        }

        if (hero.heroType.endsWith("3") || hero.heroType.endsWith("Legendary")) {
          type = "Legendary"; // Hậu tố 3 là Legendary
        } else if (hero.heroType.endsWith("2") || hero.heroType.endsWith("Epic")) {
          type = "Epic"; // Hậu tố 2 là Epic
        } else {
          type = "Rare"; // Hậu tố Rare
        }
        return {
          ...hero,
          type,
          cards,
        };
      })
      .filter(
        (h) =>
          h.unlockAt == 0 &&
          ((h.cards >= h.costStar && h.stars < h.maxStars) ||
            (settings.TYPE_HERO_UPGRADE.includes(h.type) && h.level < settings.MAX_LEVEL_UGRADE_HERO && h.costLevelGreen <= greenStonesAvailable && h.costLevelGold <= goldAvailable))
      )
      .sort((a, b) => typeMapping[a.type] - typeMapping[b.type]);
    if (upgrades.length == 0) {
      return this.log(`No hero available to upgrade!`, "warning");
    }
    for (const hero of upgrades) {
      //up start
      if (hero.cards >= hero.costStar && hero.stars < hero.maxStars) {
        const resUpStar = await this.starUpHero({
          heroType: hero.heroType,
        });
        if (resUpStar.success) {
          this.log(`Upgrade hero ${hero.name} to star ${hero.stars + 1} successful!`, "success");
          const newHereos = upgrades.filter((h) => h.heroType !== resUpStar.data.heroType);
          data["heroes"] = [...newHereos, resUpStar.data];
        }
      }

      //up level
      if (hero.costLevelGreen > greenStonesAvailable || hero.costLevelGold > goldAvailable || hero.level >= settings.MAX_LEVEL_UGRADE_HERO) continue;
      await sleep(1);
      this.log(`Starting upgrade hero ${hero.name} | level ${hero.level} | Star ${hero.stars}...`, "info");

      const resUp = await this.levelUpHero({
        heroType: hero.heroType,
      });

      if (resUp.success) {
        this.log(`Upgrade hero ${hero.name} to level ${hero.level + 1} successful!`, "success");
        greenStonesAvailable -= hero.costLevelGreen;
        goldAvailable -= hero.costLevelGold;
        const newHereos = upgrades.filter((h) => h.heroType !== resUp.data.hero.heroType);
        data["heroes"] = [...newHereos, resUp.data.hero];
      } else {
        this.log(`Upgrade hero ${hero.name} failed!`, "warning");
      }
    }

    // const { data: userInfo } = await this.getUserInfo();
    // if (userInfo) {
    // }
    return data;
    // return await this.handleUpgradeHeroes(data);
  }

  async handleShop() {
    const res = await this.getShop();
    if (!res.success) return;
    const shopFree = res.data.shop.find((s) => s.slotType == "free");
    if (shopFree && Date.now() > shopFree?.nextClaimAt) {
      const claimRes = await this.byShop();
      if (claimRes.success) {
        this.log(`Buy shop free success! | Reward: ${shopFree.content[0].amount} ${shopFree.content[0].resourceType}`, "success");
      }
    }
  }

  async handleReff() {
    const result = await this.getReff();
    if (result.success) {
      const { claimAvailible } = result.data;
      if (claimAvailible) {
        await this.claimReff();
      }
    }
  }

  async handleGame(data) {
    let { meta, heroes } = data;
    heroes = heroes.filter((h) => h.unlockAt == 0).sort((a, b) => b.power - a.power);
    let result = {
      success: false,
      data: { constellations: [] },
    };
    let startIndexMap = settings.MAP_RANGE_CHALLENGE[0] - 1;
    let endIndexMap = startIndexMap + 10;
    if (
      settings.MAP_RANGE_CHALLENGE[1] == 0 ||
      !settings.ENABLE_MAP_RANGE_CHALLENGE ||
      (settings.MAP_RANGE_CHALLENGE[0] == 0 && settings.MAP_RANGE_CHALLENGE[1] == 0) ||
      settings.MAP_RANGE_CHALLENGE[0] > settings.MAP_RANGE_CHALLENGE[1]
    ) {
      startIndexMap = meta.constellationsLastIndex;
    } else {
      endIndexMap = Math.min(meta.constellationsLastIndex, Math.max(0, settings.MAP_RANGE_CHALLENGE[1] - 1));
    }
    // if (endIndexMap - startIndexMap > 10) {
    //   this.log(`WARNING: Range map clear > 10 [Start at: ${endIndexMap} , End at: ${endIndexMap}]. Should be less than 10`);
    // }
    this.log(`Checking challenge map from  ${startIndexMap + 1} to ${startIndexMap + 11}`);
    await sleep(2);
    const res = await this.getConstellations({
      amount: 10,
      startIndex: startIndexMap,
    });
    if (res.success) {
      result = {
        success: true,
        data: { constellations: [...result.data.constellations, ...res.data.constellations] },
      };
    }
    // for (let i = startIndexMap; i <= endIndexMap; i++) {
    // }

    const { constellations } = result.data;
    if (!result.success || constellations.length == 0) return;

    for (const constellation of constellations) {
      this.log(`Starting challenge at map ${constellation.name}`);
      const challenges = constellation.challenges.filter((c) => c.received < c.value);
      if (challenges.length == 0) {
        // this.log(
        //   `You are proccessing challenge ${startIndexMap == endIndexMap ? `at map ${endIndexMap + 1}` : `from map ${startIndexMap + 1} to ${endIndexMap + 1}`} | No challenge to go at map ${
        //     constellation.name
        //   }`,
        //   "warning"
        // );
        continue;
      }
      for (const change of challenges) {
        await sleep(1);
        if (Date.now() < change.unlockAt) {
          const timeDifference = change.unlockAt - Date.now();
          const seconds = Math.floor((timeDifference / 1000) % 60);
          const minutes = Math.floor((timeDifference / (1000 * 60)) % 60);
          const hours = Math.floor((timeDifference / (1000 * 60 * 60)) % 24);
          this.log(`Waiting for ${hours} hours ${minutes} minutes ${seconds} seconds to complete challenge ${change.name} | Map ${constellation.name}...`.yellow);
          continue;
        }
        if (change.cooldown > 0) continue;

        let orderedSlots = [];
        let orderedHeroId = [];
        let isPlay = true;
        for (let index = 0; index < change.orderedSlots.length; index++) {
          const slot = change.orderedSlots[index];
          if (!slot.unlocked) continue;
          // fs.writeFileSync("save.json", JSON.stringify(heroes, null, 2), "utf-8");
          const hero = heroes.find((h) => !orderedHeroId.includes(h.heroType) && (slot.optional ? true : h.class == slot.heroClass) && h.level >= change.minLevel && h.stars >= change.minStars);
          if (hero) {
            orderedHeroId.push(hero.heroType);
            orderedSlots.push({
              heroType: hero.heroType,
              slotId: index,
              skill: hero.skill,
            });
          } else {
            continue;
          }
        }

        //check slot
        const hasHeroMapSkill = orderedSlots.find((s) => s.skill.slice(0, -1) == change.heroSkill.slice(0, -1));
        if (orderedSlots.length == 0 && !hasHeroMapSkill) {
          isPlay = false;
          this.log(`No hero avaliable to go change ${change.name}`, "warning");
        }

        // let payload = {}
        if (isPlay) {
          let payload = {
            challengeType: change.challengeType,
            heroes: orderedSlots,
          };
          payload = {
            ...payload,
            heroes: payload.heroes.map((item) => ({ heroType: item.heroType, slotId: item.slotId })),
          };
          this.log(`Starting change ${change.name} | Reward received: ${change.received}/${change.value} ${change.resourceType} | Time: ${change.time} seconds...`);
          const resChange = await this.sendToChallenge(payload);
          if (resChange.success) {
            this.log(`Started challenge ${change.name} | Map ${constellation.name} | Reward ${change.resourceType} successfully`, "success");
            heroes = heroes.filter((hero) => !payload.heroes.some((excluded) => excluded.heroType === hero.heroType));
          } else {
            this.log(`Started challenge ${change.name} failed`, "warning");
            console.log(resChange);
          }
        }
      }
    }
  }

  async handleChallengeClan(data) {
    let { heroes, clanInfo } = data;
    let { clanId } = clanInfo;
    if (!clanId) {
      clanId = this.handleClan(data);
    }
    if (!clanId) {
      return this.log(`You did not join in any clan!`, "warning");
    }

    const resClan = await this.getClanDetail(clanId);
    if (!resClan.success) return this.log(`Can't get info clan!`, "warning");
    heroes = heroes.filter((h) => h.unlockAt == 0).sort((a, b) => b.power - a.power);
    let { constellations } = resClan.data;
    constellations = constellations.filter((i) => i.progress < 100);
    if (constellations.length == 0) return;
    for (const constellation of constellations) {
      this.log(`Starting challenge clan at map ${constellation.name}`);
      const challenges = constellation.challenges.filter((c) => c.received < c.value);
      if (challenges.length == 0) {
        // this.log(
        //   `You are proccessing challenge clan ${startIndexMap == endIndexMap ? `at map ${endIndexMap + 1}` : `from map ${startIndexMap + 1} to ${endIndexMap + 1}`} | No challenge to go at map ${
        //     constellation.name
        //   }`,
        //   "warning"
        // );
        continue;
      }
      for (const change of challenges) {
        await sleep(1);
        if (Date.now() < change.unlockAt) {
          const timeDifference = change.unlockAt - Date.now();
          const seconds = Math.floor((timeDifference / 1000) % 60);
          const minutes = Math.floor((timeDifference / (1000 * 60)) % 60);
          const hours = Math.floor((timeDifference / (1000 * 60 * 60)) % 24);
          this.log(`Waiting for ${hours} hours ${minutes} minutes ${seconds} seconds to complete challenge ${change.name}...`.yellow);
          continue;
        }
        if (change.cooldown > 0) continue;

        let orderedSlots = [];
        let orderedHeroId = [];
        let isPlay = true;
        for (let index = 0; index < change.orderedSlots.length; index++) {
          const slot = change.orderedSlots[index];
          if (!slot.unlocked) continue;
          // fs.writeFileSync("save.json", JSON.stringify(heroes, null, 2), "utf-8");
          const hero = heroes.find((h) => !orderedHeroId.includes(h.heroType) && (slot.optional ? true : h.class == slot.heroClass) && h.level >= change.minLevel && h.stars >= change.minStars);
          if (hero) {
            orderedHeroId.push(hero.heroType);
            orderedSlots.push({
              heroType: hero.heroType,
              slotId: index,
              skill: hero.skill,
            });
          } else {
            continue;
          }
        }

        //check slot
        const hasHeroMapSkill = orderedSlots.find((s) => s.skill.slice(0, -1) == change.heroSkill.slice(0, -1));
        if (orderedSlots.length == 0 && !hasHeroMapSkill) {
          isPlay = false;
          this.log(`No hero avaliable to go challenge clan ${change.name}`, "warning");
        }

        // let payload = {}
        if (isPlay) {
          let payload = {
            challengeType: change.challengeType,
            heroes: orderedSlots,
          };
          payload = {
            ...payload,
            heroes: payload.heroes.map((item) => ({ heroType: item.heroType, slotId: item.slotId })),
          };
          this.log(`Starting challenge clan ${change.name} | Reward received: ${change.received}/${change.value} ${change.resourceType} | Time: ${change.time} seconds...`);
          const resChange = await this.sendToChallenge(payload);
          if (resChange.success) {
            this.log(`Started challenge clan ${change.name} | Reward ${change.resourceType} successfully`, "success");
            heroes = heroes.filter((hero) => !payload.heroes.some((excluded) => excluded.heroType === hero.heroType));
          } else {
            this.log(`Started challenge clan ${change.name} failed`, "warning");
            console.log(resChange);
          }
        }
      }
    }
  }

  async handleClan(data) {
    const { clanInfo } = data;
    if (clanInfo?.clanId) {
      this.log(`Joined clan ${clanInfo.name}!`, "warning");
      return clanInfo.clanId;
    }
    const result = await this.getClans();
    if (!result.success) return;
    const { items } = result.data;
    if (items?.length > 0) {
      const index = Math.floor(Math.random() * items.length);
      let clan = items[index];

      const resJoin = await this.joinClan(clan.id);
      if (resJoin.success) {
        this.log(`Join clan ${clan.name} sucessfully!`, "success");
        return clan.id;
      }
    }
    return null;
  }

  async handleCode() {
    this.log(`Checking gift code...`);
    const codes = settings.CODE_GATEWAY;
    for (const code of codes) {
      const result = await this.useRedeemCode(code);
      if (result.success) {
        let { rewards } = result.data;
        rewards = Object.entries(rewards);
        for (const reward of rewards) {
          this.log(`Code ${code} sucessfully! | Reward: ${reward[1]?.amount} ${reward[0]}`, "success");
        }
      } else {
        this.log(`Code ${code} wrong or expried or claimed!`, "warning");
      }
    }
  }

  async handleClaim(data) {
    const { meta } = data;
    if (Date.now() > meta.nextChallengeClaimDate && meta.nextChallengeClaimDate > 0) {
      const ressult = await this.claimChallengesRewards();
      if (ressult.success) {
        let { rewards } = ressult.data;
        rewards = Object.entries(rewards);
        for (const reward of rewards) {
          this.log(`Claimed challenge successfully! | Reward: ${reward[1].amount} ${reward[0]}`, "success");
        }
      }
    }
  }

  async runAccount() {
    try {
      this.proxyIP = await this.checkProxyIP();
    } catch (error) {
      this.log(`Cannot check proxy IP: ${error.message}`, "warning");
      return;
    }

    const accountIndex = this.accountIndex;
    const initData = this.queryId;
    const queryData = JSON.parse(decodeURIComponent(initData.split("user=")[1].split("&")[0]));
    const firstName = queryData.first_name || "";
    const lastName = queryData.last_name || "";
    this.session_name = queryData.id;

    const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
    console.log(`=========Tài khoản ${accountIndex + 1}| ${firstName + " " + lastName} | ${this.proxyIP} | Bắt đầu sau ${timesleep} giây...`.green);
    this.#set_headers();
    await sleep(timesleep);

    let userData = { success: false },
      retries = 0;
    do {
      userData = await this.getUserInfo();
      if (userData?.success) break;
      retries++;
    } while (retries < 2);

    // process.exit(0);
    if (userData.success) {
      let { initData, player, verified } = userData.data;
      const { resources } = player;
      this.log(
        `Username: ${initData.username} | Gem: ${resources.gem.amount} | Gold: ${resources.gold.amount} | Green stone: ${resources.greenStones.amount} | Purple stone: ${
          resources.purpleStones.amount
        } | Verified: ${verified.toString()}`
      );

      if (settings.AUTO_CODE_GATEWAY) {
        await this.handleCode();
      }

      await this.handleDaily(player);
      await sleep(2);
      await this.handleClaim(player);
      await sleep(2);
      await this.handleShop();
      await sleep(2);
      await this.handleGacha(player);

      await this.handleClan(player);

      if (settings.AUTO_RESET_HERO) {
        await sleep(2);
        player = await this.handleResetHeroes(player);
      }

      if (settings.AUTO_UGRADE_HERO) {
        await sleep(2);
        await this.handleUpgradeHeroes(player);
      }

      if (settings.AUTO_CHALLENGE_CLAN) {
        await sleep(2);
        await this.handleChallengeClan(player);
      }

      if (settings.AUTO_CHALLENGE) {
        await sleep(2);
        await this.handleGame(player);
      }
    } else {
      return this.log("Can't get use info...skipping", "error");
    }
  }
}

async function runWorker(workerData) {
  const { queryId, accountIndex, proxy, hasIDAPI } = workerData;
  const to = new ClientAPI(queryId, accountIndex, proxy, hasIDAPI);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  const queryIds = loadData("data.txt");
  const proxies = loadData("proxy.txt");

  if (queryIds.length > proxies.length) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${queryIds.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  console.log("https://t.me/AirdropScript6".yellow);
  let maxThreads = settings.MAX_THEADS;

  const { endpoint: hasIDAPI, message } = await checkBaseUrl();
  if (!hasIDAPI) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);
  // process.exit();
  queryIds.map((val, i) => new ClientAPI(val, i, proxies[i], hasIDAPI).createUserAgent());

  await sleep(1);
  while (true) {
    let currentIndex = 0;
    const errors = [];

    while (currentIndex < queryIds.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, queryIds.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI,
            queryId: queryIds[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              if (settings.ENABLE_DEBUG) {
                console.log(message);
              }
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < queryIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    await updateEnv("AUTO_CODE_GATEWAY", "false");
    await sleep(3);
    console.log("https://t.me/AirdropScript6".yellow);
    console.log(`=============Hoàn thành tất cả tài khoản | Chờ ${settings.TIME_SLEEP} phút=============`.magenta);
    await sleep(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
