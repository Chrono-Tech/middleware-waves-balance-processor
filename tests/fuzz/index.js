/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const models = require('../../models'),
  config = require('../../config'),
  _ = require('lodash'),
  providerService = require('../../services/providerService'),
  Api = require('../utils/Api'),
  expect = require('chai').expect,
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

    await ctx.amqp.channel.deleteQueue(`${config.rabbit.serviceName}.balance_processor`);
    ctx.balanceProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(10000);
  });


  it('validate balance processor update balance ability', async () => {
    const address = ctx.accounts[0];

    const transaction = {
        address
    };
    await ctx.amqp.channel.assertQueue(`app_${config.rabbit.serviceName}_test_fuzz.balance`, {autoDelete: true, durable: false});
    await ctx.amqp.channel.bindQueue(`app_${config.rabbit.serviceName}_test_fuzz.balance`, 'events', `${config.rabbit.serviceName}_balance.${address}`);

    await ctx.amqp.channel.publish('events', `${config.rabbit.serviceName}_transaction.${address}`, new Buffer(JSON.stringify(transaction)));

    await new Promise((res) => {
      ctx.amqp.channel.consume(`app_${config.rabbit.serviceName}_test_fuzz.balance`, async data => {

        if (!data)
          return;

        const message = JSON.parse(data.content.toString());

        if (message.address === address) {
          await ctx.amqp.channel.deleteQueue(`app_${config.rabbit.serviceName}_test_fuzz.balance`);
          res();
        }

      });
    });

    let account = await models.accountModel.findOne({address: address});
    const instance = await providerService.get();
    const balance = await instance.getBalanceByAddress(address);
    expect(account.balance, balance);
  });


  it('kill balance processor', async () => {
    ctx.balanceProcessorPid.kill();
  });


  it('restart balance processor', async () => {
    const instance = await providerService.get();

    const address = ctx.accounts[0];

    ctx.balanceProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(20000);

    const api = new Api({http: config.dev.providerForTest});
    const data = await api.getTransactions(address, 1);
    const tx = data[0];
    await ctx.amqp.channel.publish('events', `${config.rabbit.serviceName}_transaction.${address}`, new Buffer(JSON.stringify(tx)));
    await Promise.delay(5000);

    let account = await models.accountModel.findOne({address: address});
    const balance = await instance.getBalanceByAddress(address);
    expect(account.balance, balance);

  });


  after(async () => {
    ctx.balanceProcessorPid.kill();
  });


};
