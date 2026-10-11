-- 至多5个业务规则及1个调试上限；每规则day/bucket/version三键，同slot原子准入。
-- 返回-1要求重读较新修订，-2表示共享状态损坏；两者都不消费额度。
local n = #KEYS / 3
if n < 1 or n > 6 or n ~= math.floor(n) or #ARGV ~= n * 7 then return {-2} end
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local day = math.floor(now / 86400000)
local midnight = (day + 1) * 86400
local states = {}
local formalAllowed, shadowAllowed = true, true
local primary, retry = 0, 0
local function seconds(ms) return math.max(1, math.ceil(ms / 1000)) end

-- 先读完并验证所有规则；任何一条损坏都不得部分写入。
for i = 1, n do
    local k, a = (i - 1) * 3, (i - 1) * 7
    for j = 1, 3 do
        local kind = redis.call('TYPE', KEYS[k + j]).ok
        if kind ~= 'none' and kind ~= (j == 3 and 'string' or 'hash') then return {-2} end
    end
    local s = {daily = KEYS[k + 1], bucket = KEYS[k + 2], watermark = KEYS[k + 3],
        version = ARGV[a + 1], enabled = ARGV[a + 2] == '1', observe = ARGV[a + 3] == '2',
        rate = tonumber(ARGV[a + 4]), capacity = tonumber(ARGV[a + 5]) * 1000,
        quota = tonumber(ARGV[a + 6]), ip = ARGV[a + 7] == '1', reason = 0, retry = 0, ttl = 120000}
    local version = redis.call('GET', s.watermark)
    if version and (not tonumber(version) or tonumber(version) < 0 or tonumber(version) ~= math.floor(tonumber(version))) then return {-2} end
    if version and tonumber(version) > tonumber(s.version) then return {-1} end
    local daily = redis.call('HMGET', s.daily, 'day', 'count')
    if redis.call('EXISTS', s.daily) == 1 and (daily[1] == false or daily[2] == false) then return {-2} end
    local storedDay, storedCount = tonumber(daily[1] or day), tonumber(daily[2] or '0')
    if not storedDay or not storedCount or storedDay < 0 or storedDay > day or storedDay ~= math.floor(storedDay)
            or storedCount < 0 or storedCount > 9007199254740990 or storedCount ~= math.floor(storedCount) then return {-2} end
    s.dayCount = storedDay == day and storedCount or 0
    local bucket = redis.call('HMGET', s.bucket, 'tokens', 'at', 'rate', 'capacity')
    if redis.call('EXISTS', s.bucket) == 1 then
        local tokens, at, rate, capacity = tonumber(bucket[1]), tonumber(bucket[2]), tonumber(bucket[3]), tonumber(bucket[4])
        if not tokens or not at or not rate or not capacity or tokens < 0 or tokens > capacity or tokens ~= math.floor(tokens)
                or at < 0 or at ~= math.floor(at) or rate <= 0 or rate > 1000000 or rate ~= math.floor(rate)
                or capacity <= 0 or capacity > 1000000000 or capacity ~= math.floor(capacity) then return {-2} end
        s.tokens = math.min(capacity, tokens + math.min(math.max(0, now - at), math.ceil(capacity / rate)) * rate)
        s.bucketAt = math.max(now, at)
        s.ttl = math.max(s.ttl, math.ceil(capacity / rate) + 60000)
    end
    if s.enabled then
        if not s.ip then s.reason = 1 end
        if s.rate > 0 then
            -- 新桶有完整突发额度；调大已有桶不赠送余额，调小容量立即钳制。
            s.tokens = math.min(s.tokens or s.capacity, s.capacity)
            s.bucketAt = s.bucketAt or now
            s.ttl = math.max(s.ttl, math.ceil(s.capacity / s.rate) + 60000)
            s.writeBucket = true
            if s.tokens < 1000 and s.reason == 0 then s.reason = 3; s.retry = seconds((1000 - s.tokens) / s.rate) end
        end
        if s.quota > 0 and s.dayCount >= s.quota and s.reason ~= 1 then
            local wait = seconds(midnight * 1000 - now)
            if wait >= s.retry then s.reason = 4; s.retry = wait end
        end
        if s.reason ~= 0 then
            if s.observe then shadowAllowed = false
            else
                formalAllowed = false
                if s.reason == 1 then primary = 1; retry = 0
                elseif primary ~= 1 and (primary == 0 or s.retry > retry) then primary = s.reason; retry = s.retry end
            end
        end
    end
    states[i] = s
end

local result = {formalAllowed and 1 or 0, primary, retry, n}
for _, s in ipairs(states) do
    local admit = s.enabled and ((s.observe and shadowAllowed) or (not s.observe and formalAllowed))
    redis.call('SET', s.watermark, s.version, 'PX', math.max(s.ttl, redis.call('PTTL', s.watermark)))
    if s.writeBucket then
        if admit then s.tokens = s.tokens - 1000 end
        redis.call('HSET', s.bucket, 'tokens', s.tokens, 'at', s.bucketAt, 'rate', s.rate, 'capacity', s.capacity)
        redis.call('PEXPIRE', s.bucket, s.ttl)
    end
    if admit then
        -- 不限日配额时也累计已准入次数；切换模式/调额不清空当日用量。
        redis.call('HSET', s.daily, 'day', day, 'count', string.format('%.0f', s.dayCount + 1))
        redis.call('EXPIREAT', s.daily, midnight)
    end
    table.insert(result, s.reason)
    table.insert(result, s.retry)
    table.insert(result, s.rate > 0 and 2 or 0)
end
return result
