/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const models = require('../../models'),
  Api = require('../utils/Api'),
  config = require('../../config'),
  getUpdatedBalance = require('../../utils/balance/getUpdatedBalance'),
  expect = require('chai').expect,
  providerService = require('../../services/providerService'),
  sender = require('../utils/sender'),
  Promise = require('bluebird'),
  spawn = require('child_process').spawn;

module.exports = (ctx) => {

  before(async () => {
    await models.accountModel.remove({});

    await models.accountModel.create({
      address: ctx.accounts[0],
      balance: 0,
      isActive: true
    });
    ctx.balanceCalcTime = 10000;

    await ctx.amqp.channel.deleteQueue(`${config.rabbit.serviceName}.balance_processor`);
    ctx.balanceProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'inherit'});
    await Promise.delay(10000);
  });


  it('generate transation', async () => {
    await sender.sendTransaction(ctx.accounts[0], ctx.accounts[1], 10);
  });


  it('validate unconfirmed balance calculate performance and leaks', async () => {
    const address = ctx.accounts[0];

    let start = Date.now();
    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    await getUpdatedBalance(address);
    global.gc();
    await Promise.delay(5000);
    const memUsage2 = process.memoryUsage().heapUsed / 1024 / 1024;

    expect(memUsage2 - memUsage).to.be.below(3);
    expect(Date.now() - start).to.be.below(10000);
  });

  it('validate balance processor notification speed', async () => {
    const address = ctx.accounts[0];

    await ctx.amqp.channel.assertQueue(`app_${config.rabbit.serviceName}_test_performance.balance`, {autoDelete: true, durable: false});
    await ctx.amqp.channel.bindQueue(`app_${config.rabbit.serviceName}_test_performance.balance`, 'events', `${config.rabbit.serviceName}_balance.${address}`);

    const start = Date.now();
    await ctx.amqp.channel.publish('events', `${config.rabbit.serviceName}_transaction.${address}`, new Buffer(JSON.stringify({address: address})));

    await new Promise((res) => {
      ctx.amqp.channel.consume(`app_${config.rabbit.serviceName}_test_performance.balance`, res, {noAck: true});
    });

    await ctx.amqp.channel.deleteQueue(`app_${config.rabbit.serviceName}_test_performance.balance`);
    expect(Date.now() - start).to.be.below(500 + ctx.balanceCalcTime);
  });



  after(async () => {
    delete ctx.balanceCalcTime;
    ctx.balanceProcessorPid.kill();
  });


};
