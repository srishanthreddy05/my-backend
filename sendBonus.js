const { ethers } = require("ethers");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider(process.env.INFURA_API);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const tokenAddress = process.env.TOKEN_CONTRACT;
const tokenABI = [
  "function transfer(address to, uint amount) public returns (bool)",
  "function decimals() public view returns (uint8)"
];

const contract = new ethers.Contract(tokenAddress, tokenABI, wallet);

async function sendBonus(toAddress, amount) {
  const decimals = await contract.decimals();
  const value = ethers.parseUnits(amount.toString(), decimals);

  const tx = await contract.transfer(toAddress, value);
  await tx.wait();

  console.log(`✅ Sent ${amount} tokens to ${toAddress}`);
  return tx.hash;
}

module.exports = sendBonus;
